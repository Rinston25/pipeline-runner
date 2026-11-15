import { transitiveDependents } from './graph.js';

// Runs a task graph: a task starts only after all its dependencies succeeded, independent
// tasks run concurrently, and at most `concurrency` tasks run at the same time.
//
// Failure policy:
//   - A failed task is recorded as "failed" together with its error message.
//   - Every task that directly or indirectly depends on it is "skipped" and never starts.
//   - Tasks on unrelated branches keep running, so one failure wastes as little work as possible.
//
// This module knows nothing about databases or Redis. The caller supplies:
//   runTask(task)               -> Promise; the actual work (reject to signal failure)
//   onTaskStart(task)           -> called just before a task begins
//   onTaskFinish(task, outcome) -> called once per task with its final state:
//                                  { status: 'success' | 'failed' | 'skipped',
//                                    startedAt, finishedAt, elapsedMs, error }
// If a callback itself throws (for example the database is down), executeTasks rejects:
// that is an infrastructure problem, not a task failure.

export async function executeTasks({ tasks, concurrency, runTask, onTaskStart, onTaskFinish }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }

  const tasksByName = new Map(tasks.map((task) => [task.name, task]));
  const statusByName = new Map(tasks.map((task) => [task.name, 'pending']));
  const running = new Map(); // task name -> promise that settles when the task is done

  const isReady = (task) =>
    statusByName.get(task.name) === 'pending' &&
    task.dependsOn.every((dependency) => statusByName.get(dependency) === 'success');

  // Mark everything downstream of a failed task as skipped.
  async function skipDependents(failedTask) {
    const toSkip = [...transitiveDependents(tasks, failedTask.name)].filter(
      (name) => statusByName.get(name) === 'pending',
    );
    // Update all statuses first: another task may fail while we await the callbacks below,
    // and it must not skip the same tasks twice.
    for (const name of toSkip) statusByName.set(name, 'skipped');

    for (const name of toSkip) {
      await onTaskFinish(tasksByName.get(name), {
        status: 'skipped',
        finishedAt: new Date(),
        error: `Skipped because upstream task "${failedTask.name}" failed`,
      });
    }
  }

  // Execute one task and report its outcome.
  async function runOne(task) {
    const startedAt = new Date();
    await onTaskStart(task);

    let failure = null;
    try {
      await runTask(task);
    } catch (error) {
      failure = error;
    }

    const finishedAt = new Date();
    const status = failure ? 'failed' : 'success';
    statusByName.set(task.name, status);
    await onTaskFinish(task, {
      status,
      startedAt,
      finishedAt,
      elapsedMs: finishedAt - startedAt,
      error: failure ? failure.message || String(failure) : undefined,
    });

    if (failure) await skipDependents(task);
    return task.name;
  }

  while (true) {
    // Fill every free slot with a task whose dependencies are all done.
    for (const task of tasks) {
      if (running.size >= concurrency) break;
      if (!isReady(task)) continue;
      statusByName.set(task.name, 'running');
      running.set(task.name, runOne(task));
    }

    if (running.size === 0) break;

    // Wait for any one running task to finish, then look for newly unblocked tasks.
    const finishedName = await Promise.race(running.values());
    running.delete(finishedName);
  }

  const stuck = tasks.filter((task) => statusByName.get(task.name) === 'pending');
  if (stuck.length > 0) throw new Error('Tasks could not be scheduled (dependency cycle?)');

  return statusByName;
}

// A run only succeeds if every task succeeded; a skipped task means something upstream failed.
export function summarizeRunStatus(statusByName) {
  const allSucceeded = [...statusByName.values()].every((status) => status === 'success');
  return allSucceeded ? 'success' : 'failed';
}
