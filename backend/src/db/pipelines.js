import { pool, withTransaction } from './pool.js';

const UNIQUE_VIOLATION = '23505';

// Insert a pipeline with its tasks and dependency edges in one transaction.
// `input.tasks[].dependsOn` holds task NAMES; they are translated to ids here.
export async function createPipeline(input) {
  try {
    return await withTransaction(async (client) => {
      const pipelineResult = await client.query(
        'INSERT INTO pipelines (name) VALUES ($1) RETURNING id',
        [input.name],
      );
      const pipelineId = pipelineResult.rows[0].id;

      const taskIdByName = new Map();
      for (const task of input.tasks) {
        const taskResult = await client.query(
          `INSERT INTO tasks (pipeline_id, name, duration_ms, should_fail)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [pipelineId, task.name, task.durationMs, task.shouldFail],
        );
        taskIdByName.set(task.name, taskResult.rows[0].id);
      }

      for (const task of input.tasks) {
        for (const dependencyName of task.dependsOn) {
          await client.query(
            'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES ($1, $2)',
            [taskIdByName.get(task.name), taskIdByName.get(dependencyName)],
          );
        }
      }
      return pipelineId;
    });
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION && error.constraint === 'pipelines_name_key') {
      const conflict = new Error(`A pipeline named "${input.name}" already exists`);
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
}

// Every pipeline with its task count and its most recent run (if any).
export async function listPipelines() {
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.created_at,
           (SELECT count(*)::int FROM tasks t WHERE t.pipeline_id = p.id) AS task_count,
           lr.id AS run_id, lr.status AS run_status, lr.created_at AS run_created_at,
           lr.started_at AS run_started_at, lr.finished_at AS run_finished_at
    FROM pipelines p
    LEFT JOIN LATERAL (
      SELECT * FROM runs r WHERE r.pipeline_id = p.id ORDER BY r.created_at DESC LIMIT 1
    ) lr ON true
    ORDER BY p.created_at DESC`);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    taskCount: row.task_count,
    latestRun: row.run_id
      ? {
          id: row.run_id,
          status: row.run_status,
          createdAt: row.run_created_at,
          startedAt: row.run_started_at,
          finishedAt: row.run_finished_at,
        }
      : null,
  }));
}

// One pipeline with tasks; each task lists the NAMES of the tasks it depends on.
export async function getPipeline(id) {
  const pipelineResult = await pool.query(
    'SELECT id, name, created_at FROM pipelines WHERE id = $1',
    [id],
  );
  if (pipelineResult.rowCount === 0) return null;

  const taskResult = await pool.query(
    `SELECT t.id, t.name, t.duration_ms, t.should_fail,
            COALESCE(
              array_agg(dep.name ORDER BY dep.name) FILTER (WHERE dep.id IS NOT NULL), '{}'
            ) AS depends_on
     FROM tasks t
     LEFT JOIN task_dependencies td ON td.task_id = t.id
     LEFT JOIN tasks dep ON dep.id = td.depends_on_task_id
     WHERE t.pipeline_id = $1
     GROUP BY t.id
     ORDER BY t.name`,
    [id],
  );

  const pipeline = pipelineResult.rows[0];
  return {
    id: pipeline.id,
    name: pipeline.name,
    createdAt: pipeline.created_at,
    tasks: taskResult.rows.map((task) => ({
      id: task.id,
      name: task.name,
      durationMs: task.duration_ms,
      shouldFail: task.should_fail,
      dependsOn: task.depends_on,
    })),
  };
}
