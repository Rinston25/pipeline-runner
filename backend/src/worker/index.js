import { config, QUEUE_KEY } from '../config.js';
import { createRedis } from '../redis.js';
import { pool } from '../db/pool.js';
import { executeRun } from './executeRun.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// BRPOP blocks its connection, so commands and publishing use a second one.
const queueConnection = createRedis();
const redis = createRedis();

let activeRuns = 0;
let stopping = false;

async function pickUpRuns() {
  while (!stopping) {
    if (activeRuns >= config.runConcurrency) {
      await sleep(100);
      continue;
    }
    // Short timeout so the loop notices a shutdown request.
    const popped = await queueConnection.brpop(QUEUE_KEY, 2);
    if (!popped) continue;

    const runId = popped[1];
    activeRuns += 1;
    executeRun(runId, redis)
      .catch((error) => console.error(`Run ${runId} crashed:`, error))
      .finally(() => {
        activeRuns -= 1;
      });
  }
}

async function shutdown() {
  if (stopping) return;
  console.log('Shutting down: finishing active runs first');
  stopping = true;
  while (activeRuns > 0) await sleep(200);
  queueConnection.disconnect();
  redis.disconnect();
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log(
  `Worker started (runs in parallel: ${config.runConcurrency}, tasks per run: ${config.taskConcurrency})`,
);
await pickUpRuns();
