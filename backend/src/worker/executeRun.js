import { config } from '../config.js';
import { publishEvent } from '../redis.js';
import { executeTasks, summarizeRunStatus } from '../engine/scheduler.js';
import {
  abortRun,
  claimRun,
  finishRun,
  loadRunTasks,
  markTaskFinished,
  markTaskRunning,
  touchHeartbeat,
} from '../db/runs.js';
import { simulateTask } from './taskRunner.js';

// Execute one queued run: claim it, run its tasks, record every state change, announce it.
export async function executeRun(runId, redis) {
  const pipelineId = await claimRun(runId);
  if (!pipelineId) return; // someone else already owns this run

  const announce = (type, extra = {}) =>
    publishEvent(redis, { type, runId, pipelineId, ...extra });

  await announce('run.updated', { status: 'running' });

  // Keep the heartbeat fresh while we work so other workers know we are alive.
  const heartbeat = setInterval(() => {
    touchHeartbeat(runId).catch((error) => console.error('Heartbeat failed:', error.message));
  }, config.heartbeatIntervalMs);

  let finalStatus;
  try {
    const tasks = await loadRunTasks(runId);
    const statusByName = await executeTasks({
      tasks,
      concurrency: config.taskConcurrency,
      runTask: simulateTask,
      onTaskStart: async (task) => {
        await markTaskRunning(runId, task.name, new Date());
        await announce('task.updated', { taskName: task.name, status: 'running' });
      },
      onTaskFinish: async (task, outcome) => {
        await markTaskFinished(runId, task.name, outcome);
        await announce('task.updated', { taskName: task.name, status: outcome.status });
      },
    });

    finalStatus = summarizeRunStatus(statusByName);
    const failedNames = tasks
      .filter((task) => statusByName.get(task.name) === 'failed')
      .map((task) => task.name);
    const runError = failedNames.length > 0 ? `Failed tasks: ${failedNames.join(', ')}` : null;
    await finishRun(runId, finalStatus, runError);
  } catch (error) {
    // Something unexpected (not a task failure) went wrong. Record it instead of leaving
    // the run stuck in "running", and never report it as a success.
    console.error(`Run ${runId} aborted:`, error);
    finalStatus = 'failed';
    await abortRun(runId, `Run aborted: ${error.message}`).catch((abortError) =>
      console.error(`Could not record abort for run ${runId}:`, abortError.message),
    );
  } finally {
    clearInterval(heartbeat);
  }
  await announce('run.updated', { status: finalStatus });
}
