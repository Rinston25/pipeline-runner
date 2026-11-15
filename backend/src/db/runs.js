import { pool, withTransaction } from './pool.js';
import { topologicalOrder } from '../engine/graph.js';

// Atomically move a run from queued to running. Returns the pipeline id, or null when
// the run is not queued any more (another worker took it, or it is a duplicate queue entry).
export async function claimRun(runId) {
  const { rows } = await pool.query(
    `UPDATE runs SET status = 'running', started_at = now(), heartbeat_at = now()
     WHERE id = $1 AND status = 'queued'
     RETURNING pipeline_id`,
    [runId],
  );
  return rows.length > 0 ? rows[0].pipeline_id : null;
}

// The tasks of a run with their dependencies expressed as task names.
export async function loadRunTasks(runId) {
  const { rows } = await pool.query(
    `SELECT rt.name, rt.duration_ms, rt.should_fail,
            COALESCE(
              array_agg(dependency.name ORDER BY dependency.name)
                FILTER (WHERE dependency.id IS NOT NULL), '{}'
            ) AS depends_on
     FROM run_tasks rt
     LEFT JOIN task_dependencies td ON td.task_id = rt.task_id
     LEFT JOIN run_tasks dependency
            ON dependency.run_id = rt.run_id AND dependency.task_id = td.depends_on_task_id
     WHERE rt.run_id = $1
     GROUP BY rt.id
     ORDER BY rt.name`,
    [runId],
  );
  return rows.map((row) => ({
    name: row.name,
    durationMs: row.duration_ms,
    shouldFail: row.should_fail,
    dependsOn: row.depends_on,
  }));
}

export async function markTaskRunning(runId, taskName, startedAt) {
  await pool.query(
    `UPDATE run_tasks SET status = 'running', started_at = $3 WHERE run_id = $1 AND name = $2`,
    [runId, taskName, startedAt],
  );
}

export async function markTaskFinished(runId, taskName, outcome) {
  await pool.query(
    `UPDATE run_tasks
     SET status = $3, finished_at = $4, elapsed_ms = $5, error = $6
     WHERE run_id = $1 AND name = $2`,
    [
      runId,
      taskName,
      outcome.status,
      outcome.finishedAt,
      outcome.elapsedMs ?? null,
      outcome.error ?? null,
    ],
  );
}

export async function finishRun(runId, status, error = null) {
  await pool.query(
    `UPDATE runs SET status = $2, finished_at = now(), error = $3 WHERE id = $1`,
    [runId, status, error],
  );
}

// Proof of life, so a crashed worker can be detected by its stale heartbeat.
export async function touchHeartbeat(runId) {
  await pool.query('UPDATE runs SET heartbeat_at = now() WHERE id = $1', [runId]);
}

// Close out a run that cannot continue (worker crashed, database error, ...).
// Tasks that were running become failed, tasks that never started become skipped, and the
// run is failed with the given reason, so nothing is left looking "in progress".
// With `staleMs` set, the run is only aborted if its heartbeat is older than that; this
// protects a run whose worker is actually alive. Returns the pipeline id, or null if skipped.
export async function abortRun(runId, reason, { staleMs } = {}) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE runs SET status = 'failed', finished_at = now(), error = $2
       WHERE id = $1 AND status = 'running'
         AND ($3::int IS NULL OR heartbeat_at < now() - ($3::int * interval '1 millisecond'))
       RETURNING pipeline_id`,
      [runId, reason, staleMs ?? null],
    );
    if (rows.length === 0) return null;

    await client.query(
      `UPDATE run_tasks
       SET status = 'failed', finished_at = now(), error = $2
       WHERE run_id = $1 AND status = 'running'`,
      [runId, reason],
    );
    await client.query(
      `UPDATE run_tasks
       SET status = 'skipped', finished_at = now(), error = 'Run was aborted before this task started'
       WHERE run_id = $1 AND status = 'pending'`,
      [runId],
    );
    return rows[0].pipeline_id;
  });
}

// Running runs whose worker has stopped sending heartbeats.
export async function listStaleRunIds(staleMs) {
  const { rows } = await pool.query(
    `SELECT id FROM runs
     WHERE status = 'running' AND heartbeat_at < now() - ($1::int * interval '1 millisecond')`,
    [staleMs],
  );
  return rows.map((row) => row.id);
}

// Runs still waiting in the database for longer than `olderThanMs`.
export async function listQueuedRunIds(olderThanMs) {
  const { rows } = await pool.query(
    `SELECT id FROM runs
     WHERE status = 'queued' AND created_at < now() - ($1::int * interval '1 millisecond')
     ORDER BY created_at`,
    [olderThanMs],
  );
  return rows.map((row) => row.id);
}

// Create a run for a pipeline, copying its tasks into run_tasks so later runs and
// inspection do not depend on the live definition. Returns null if the pipeline is missing.
export async function createRun(pipelineId) {
  return withTransaction(async (client) => {
    const pipeline = await client.query('SELECT id FROM pipelines WHERE id = $1', [pipelineId]);
    if (pipeline.rowCount === 0) return null;

    const run = await client.query('INSERT INTO runs (pipeline_id) VALUES ($1) RETURNING id', [
      pipelineId,
    ]);
    const runId = run.rows[0].id;
    await client.query(
      `INSERT INTO run_tasks (run_id, task_id, name, duration_ms, should_fail)
       SELECT $1, id, name, duration_ms, should_fail FROM tasks WHERE pipeline_id = $2`,
      [runId, pipelineId],
    );
    return runId;
  });
}

const runColumns = `
  r.id, r.pipeline_id, p.name AS pipeline_name, r.status, r.created_at, r.started_at,
  r.finished_at, r.error,
  (EXTRACT(EPOCH FROM (r.finished_at - r.started_at)) * 1000)::int AS duration_ms`;

function toRunSummary(row) {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    pipelineName: row.pipeline_name,
    status: row.status,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    error: row.error,
  };
}

// Most recent runs of a pipeline, newest first.
export async function listRuns(pipelineId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT ${runColumns}
     FROM runs r JOIN pipelines p ON p.id = r.pipeline_id
     WHERE r.pipeline_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [pipelineId, limit],
  );
  return rows.map(toRunSummary);
}

// A run with the state of every task. Tasks are returned in dependency order.
export async function getRun(runId) {
  const runResult = await pool.query(
    `SELECT ${runColumns}
     FROM runs r JOIN pipelines p ON p.id = r.pipeline_id
     WHERE r.id = $1`,
    [runId],
  );
  if (runResult.rowCount === 0) return null;

  const tasks = await loadRunTasks(runId);
  const taskResult = await pool.query(
    `SELECT name, status, started_at, finished_at, elapsed_ms, error
     FROM run_tasks WHERE run_id = $1`,
    [runId],
  );
  const stateByName = new Map(taskResult.rows.map((row) => [row.name, row]));

  const taskByName = new Map(tasks.map((task) => [task.name, task]));
  const orderedTasks = topologicalOrder(tasks).map((name) => {
    const task = taskByName.get(name);
    const state = stateByName.get(name);
    return {
      name,
      status: state.status,
      dependsOn: task.dependsOn,
      configuredDurationMs: task.durationMs,
      shouldFail: task.shouldFail,
      startedAt: state.started_at,
      finishedAt: state.finished_at,
      elapsedMs: state.elapsed_ms,
      error: state.error,
    };
  });

  return { ...toRunSummary(runResult.rows[0]), tasks: orderedTasks };
}
