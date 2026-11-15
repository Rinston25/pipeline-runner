// Runs a task graph: a task starts only after all its dependencies succeeded, independent
// tasks run concurrently, and at most `concurrency` tasks run at the same time.
//
// This module knows nothing about databases or Redis. The caller supplies:
//   runTask(task)               -> Promise; the actual work
//   onTaskStart(task)           -> called just before a task begins
//   onTaskFinish(task, outcome) -> called with { status, startedAt, finishedAt, elapsedMs }

export async function executeTasks({ tasks, concurrency, runTask, onTaskStart, onTaskFinish }) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be a positive integer');
  }

  const statusByName = new Map(tasks.map((task) => [task.name, 'pending']));
  const running = new Map(); // task name -> promise that settles when the task is done

  const isReady = (task) =>
    statusByName.get(task.name) === 'pending' &&
    task.dependsOn.every((dependency) => statusByName.get(dependency) === 'success');

  // Execute one task and report when it finished.
  async function runOne(task) {
    const startedAt = new Date();
    await onTaskStart(task);
    await runTask(task);
    const finishedAt = new Date();
    statusByName.set(task.name, 'success');
    await onTaskFinish(task, {
      status: 'success',
      startedAt,
      finishedAt,
      elapsedMs: finishedAt - startedAt,
    });
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
