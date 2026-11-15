import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTasks } from '../src/engine/scheduler.js';

const task = (name, ...dependsOn) => ({ name, dependsOn });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs the scheduler with a fake task runner that records what happened and when.
async function simulate(tasks, { concurrency = 10, delayMs = 20, failing = [] } = {}) {
  const events = []; // 'start:a' / 'end:a' in the order they happened
  let active = 0;
  let maxActive = 0;
  const outcomes = new Map();

  const statuses = await executeTasks({
    tasks,
    concurrency,
    runTask: async (current) => {
      events.push(`start:${current.name}`);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(delayMs);
      active -= 1;
      events.push(`end:${current.name}`);
      if (failing.includes(current.name)) throw new Error(`${current.name} broke`);
    },
    onTaskStart: () => {},
    onTaskFinish: (current, outcome) => outcomes.set(current.name, outcome),
  });
  return { events, maxActive, outcomes, statuses };
}

test('a task never starts before all its dependencies have finished', async () => {
  const tasks = [task('a'), task('b', 'a'), task('c', 'b'), task('d', 'a', 'c')];
  const { events } = await simulate(tasks);

  for (const { name, dependsOn } of tasks) {
    for (const dependency of dependsOn) {
      assert.ok(
        events.indexOf(`end:${dependency}`) < events.indexOf(`start:${name}`),
        `${name} started before ${dependency} ended: ${events.join(' ')}`,
      );
    }
  }
});

test('independent tasks run in parallel', async () => {
  const { events, maxActive } = await simulate([task('a'), task('b'), task('c')]);

  assert.equal(maxActive, 3);
  // All three started before any of them finished.
  assert.deepEqual(events.slice(0, 3), ['start:a', 'start:b', 'start:c']);
});

test('tasks that depend on the same parent run in parallel once it finishes', async () => {
  const { events, maxActive } = await simulate([task('root'), task('left', 'root'), task('right', 'root')]);

  assert.equal(maxActive, 2);
  assert.ok(events.indexOf('start:right') < events.indexOf('end:left'));
});

test('a join task waits for every one of its parents', async () => {
  const tasks = [task('a'), task('b'), task('join', 'a', 'b')];
  const { events } = await simulate(tasks);

  assert.ok(events.indexOf('start:join') > events.indexOf('end:a'));
  assert.ok(events.indexOf('start:join') > events.indexOf('end:b'));
});

test('the concurrency limit is never exceeded', async () => {
  const tasks = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) => task(name));
  const { maxActive, statuses } = await simulate(tasks, { concurrency: 2 });

  assert.equal(maxActive, 2);
  assert.ok([...statuses.values()].every((status) => status === 'success'));
});

test('with a concurrency of 1 tasks run strictly one at a time', async () => {
  const { events } = await simulate([task('a'), task('b'), task('c')], { concurrency: 1 });
  assert.deepEqual(events, ['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']);
});

test('a free slot is reused as soon as a task finishes', async () => {
  // Limit 2: "slow" occupies one slot while "x", "y" and "z" take turns in the other.
  const tasks = [task('slow'), task('x'), task('y'), task('z')];
  const durations = { slow: 200, x: 20, y: 20, z: 20 };
  const events = [];
  await executeTasks({
    tasks,
    concurrency: 2,
    runTask: async (current) => {
      events.push(`start:${current.name}`);
      await sleep(durations[current.name]);
      events.push(`end:${current.name}`);
    },
    onTaskStart: () => {},
    onTaskFinish: () => {},
  });

  // z must not have to wait for slow to finish.
  assert.ok(events.indexOf('start:z') < events.indexOf('end:slow'));
});

test('every task gets exactly one finish report with timing', async () => {
  const { outcomes } = await simulate([task('a'), task('b', 'a')]);

  assert.deepEqual([...outcomes.keys()].sort(), ['a', 'b']);
  for (const outcome of outcomes.values()) {
    assert.equal(outcome.status, 'success');
    assert.ok(outcome.elapsedMs >= 10, 'elapsed time should be measured');
    assert.ok(outcome.finishedAt >= outcome.startedAt);
  }
});

test('rejects an invalid concurrency value', async () => {
  await assert.rejects(
    executeTasks({
      tasks: [task('a')],
      concurrency: 0,
      runTask: async () => {},
      onTaskStart: () => {},
      onTaskFinish: () => {},
    }),
    /concurrency/,
  );
});
