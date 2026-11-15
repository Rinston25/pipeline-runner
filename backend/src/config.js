// All runtime settings come from environment variables, with local-dev defaults.
const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const config = {
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://pipeline:pipeline@localhost:5432/pipeline',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  apiPort: toInt(process.env.API_PORT, 3001),

  // Max tasks of ONE run executing at the same time.
  taskConcurrency: toInt(process.env.TASK_CONCURRENCY, 3),
  // Max runs ONE worker process executes at the same time.
  runConcurrency: toInt(process.env.RUN_CONCURRENCY, 2),

  // A running run whose heartbeat is older than this is considered abandoned.
  heartbeatIntervalMs: toInt(process.env.HEARTBEAT_INTERVAL_MS, 2000),
  staleRunAfterMs: toInt(process.env.STALE_RUN_AFTER_MS, 15000),
  // How often the worker looks for abandoned and un-enqueued runs.
  recoveryIntervalMs: toInt(process.env.RECOVERY_INTERVAL_MS, 5000),
};

export const QUEUE_KEY = 'pipeline:run-queue';
export const EVENTS_CHANNEL = 'pipeline:events';
