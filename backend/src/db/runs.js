import { pool, withTransaction } from './pool.js';

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
