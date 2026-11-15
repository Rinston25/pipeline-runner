import { config, QUEUE_KEY } from '../config.js';
import { publishEvent } from '../redis.js';
import { abortRun, listQueuedRunIds, listStaleRunIds } from '../db/runs.js';

// Repairs the damage a crashed worker or a lost Redis queue leaves behind.
// Safe to run from several workers at once: every step is guarded in the database.
export async function recoverRuns(redis) {
  // 1. A running run with no recent heartbeat lost its worker. Its tasks may have been
  //    half-done and are not safe to resume, so the run is failed, not silently retried.
  for (const runId of await listStaleRunIds(config.staleRunAfterMs)) {
    const pipelineId = await abortRun(
      runId,
      'The worker stopped before this run finished, so it was interrupted',
      { staleMs: config.staleRunAfterMs },
    );
    if (pipelineId) {
      console.warn(`Recovered abandoned run ${runId}: marked failed`);
      await publishEvent(redis, { type: 'run.updated', runId, pipelineId, status: 'failed' });
    }
  }

  // 2. A queued run missing from Redis (Redis lost data, or the API died between saving
  //    the run and pushing it) would wait forever, so push it again.
  for (const runId of await listQueuedRunIds(config.recoveryIntervalMs)) {
    if ((await redis.lpos(QUEUE_KEY, runId)) === null) {
      console.warn(`Re-enqueueing run ${runId} that was missing from the queue`);
      await redis.lpush(QUEUE_KEY, runId);
    }
  }
}
