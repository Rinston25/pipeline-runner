const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Simulated work: wait for the configured duration, then fail if the task says so.
export async function simulateTask(task) {
  await sleep(task.durationMs);
  if (task.shouldFail) {
    throw new Error(`Task "${task.name}" was configured to fail`);
  }
}
