import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTasks, summarizeRunStatus } from '../src/engine/scheduler.js';

const task = (name, ...dependsOn) => ({ name, dependsOn });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs the scheduler where the named tasks fail. `durations` can slow individual tasks down.
async function simulate(tasks, { failing = [], durations = {}, concurrency = 10 } = {}) {
  const started = [];
  const outcomes = new Map();

  const statuses = await executeTasks({
    tasks,
    concurrency,
    runTask: async (current) => {
      started.push(current.name);
      await sleep(durations[current.name] ?? 10);
      if (failing.includes(current.name)) throw new Error(`${current.name} exploded`);
    },
    onTaskStart: () => {},
    onTaskFinish: (current, outcome) => {
      assert.ok(!outcomes.has(current.name), `${current.name} was reported twice`);
      outcomes.set(current.name, outcome);
    },
  });
  return { started, outcomes, statuses };
}

test('a failed task is recorded with its error message', async () => {
  const { outcomes, statuses } = await simulate([task('a')], { failing: ['a'] });

  assert.equal(statuses.get('a'), 'failed');
  assert.equal(outcomes.get('a').status, 'failed');
  assert.equal(outcomes.get('a').error, 'a exploded');
  assert.ok(outcomes.get('a').elapsedMs >= 5);
});

test('direct and indirect dependents of a failed task are skipped and never run', async () => {
  const tasks = [task('a'), task('b', 'a'), task('c', 'b'), task('d', 'c')];
  const { started, statuses, outcomes } = await simulate(tasks, { failing: ['a'] });

  assert.deepEqual(started, ['a']);
  assert.deepEqual(
    ['b', 'c', 'd'].map((name) => statuses.get(name)),
    ['skipped', 'skipped', 'skipped'],
  );
  assert.match(outcomes.get('d').error, /upstream task "a" failed/);
});

test('tasks on unrelated branches still complete', async () => {
  const tasks = [
    task('root'),
    task('bad', 'root'),
    task('after-bad', 'bad'),
    task('good', 'root'),
    task('after-good', 'good'),
  ];
  const { statuses } = await simulate(tasks, { failing: ['bad'] });

  assert.equal(statuses.get('bad'), 'failed');
  assert.equal(statuses.get('after-bad'), 'skipped');
  assert.equal(statuses.get('good'), 'success');
  assert.equal(statuses.get('after-good'), 'success');
});

test('a join task is skipped when only one of its parents fails', async () => {
  const tasks = [task('a'), task('b'), task('join', 'a', 'b')];
  const { started, statuses } = await simulate(tasks, { failing: ['a'] });

  assert.equal(statuses.get('b'), 'success');
  assert.equal(statuses.get('join'), 'skipped');
  assert.ok(!started.includes('join'));
});

test('a task skipped by two failing parents is reported only once', async () => {
  const tasks = [task('a'), task('b'), task('join', 'a', 'b')];
  // simulate() fails the test if any task is reported twice.
  const { statuses } = await simulate(tasks, { failing: ['a', 'b'] });
  assert.equal(statuses.get('join'), 'skipped');
});

test('a task still running when another fails is allowed to finish', async () => {
  const tasks = [task('fails-fast'), task('slow-but-fine')];
  const { statuses, outcomes } = await simulate(tasks, {
    failing: ['fails-fast'],
    durations: { 'fails-fast': 10, 'slow-but-fine': 80 },
  });

  assert.equal(statuses.get('fails-fast'), 'failed');
  assert.equal(outcomes.get('slow-but-fine').status, 'success');
});

test('every task ends in exactly one final state', async () => {
  const tasks = [task('a'), task('b', 'a'), task('c'), task('d', 'b', 'c')];
  const { statuses, outcomes } = await simulate(tasks, { failing: ['a'] });

  assert.equal(outcomes.size, tasks.length);
  for (const status of statuses.values()) {
    assert.ok(['success', 'failed', 'skipped'].includes(status), `unexpected status ${status}`);
  }
});

test('a run with a failed task is never reported as successful', async () => {
  const { statuses } = await simulate([task('a'), task('b', 'a')], { failing: ['a'] });
  assert.equal(summarizeRunStatus(statuses), 'failed');
});

test('a run with a skipped task is not successful either', () => {
  const statuses = new Map([['a', 'success'], ['b', 'skipped']]);
  assert.equal(summarizeRunStatus(statuses), 'failed');
});

test('a run where everything succeeds is successful', async () => {
  const { statuses } = await simulate([task('a'), task('b', 'a')]);
  assert.equal(summarizeRunStatus(statuses), 'success');
});

test('an error in a persistence callback rejects the run instead of hiding it', async () => {
  await assert.rejects(
    executeTasks({
      tasks: [task('a')],
      concurrency: 1,
      runTask: async () => {},
      onTaskStart: () => {},
      onTaskFinish: () => {
        throw new Error('database is down');
      },
    }),
    /database is down/,
  );
});
