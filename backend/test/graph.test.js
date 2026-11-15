import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findCycle,
  topologicalOrder,
  transitiveDependents,
  validateTasks,
} from '../src/engine/graph.js';

const task = (name, ...dependsOn) => ({ name, dependsOn });

test('validateTasks accepts a valid diamond graph', () => {
  const tasks = [task('a'), task('b', 'a'), task('c', 'a'), task('d', 'b', 'c')];
  assert.deepEqual(validateTasks(tasks), []);
});

test('validateTasks rejects a reference to an unknown task', () => {
  const problems = validateTasks([task('a', 'ghost')]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /unknown task "ghost"/);
});

test('validateTasks rejects duplicate task names', () => {
  const problems = validateTasks([task('a'), task('a')]);
  assert.match(problems[0], /Duplicate task name "a"/);
});

test('validateTasks rejects a task that depends on itself', () => {
  const problems = validateTasks([task('a', 'a')]);
  assert.match(problems[0], /cannot depend on itself/);
});

test('validateTasks rejects listing the same dependency twice', () => {
  const problems = validateTasks([task('a'), task('b', 'a', 'a')]);
  assert.match(problems[0], /more than once/);
});

test('validateTasks reports a cycle with its path', () => {
  const problems = validateTasks([task('a', 'c'), task('b', 'a'), task('c', 'b')]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Dependency cycle: a -> c -> b -> a/);
});

test('findCycle returns null for an acyclic graph', () => {
  assert.equal(findCycle([task('a'), task('b', 'a')]), null);
});

test('findCycle finds a cycle that does not include the first task', () => {
  const cycle = findCycle([task('start'), task('x', 'y'), task('y', 'x', 'start')]);
  assert.deepEqual(cycle, ['x', 'y', 'x']);
});

test('topologicalOrder places every task after all of its dependencies', () => {
  const tasks = [
    task('deploy', 'build'),
    task('build', 'lint', 'test'),
    task('test', 'checkout'),
    task('lint', 'checkout'),
    task('checkout'),
  ];
  const order = topologicalOrder(tasks);

  assert.equal(order.length, tasks.length);
  for (const { name, dependsOn } of tasks) {
    for (const dependency of dependsOn) {
      assert.ok(
        order.indexOf(dependency) < order.indexOf(name),
        `${dependency} must come before ${name} in ${order.join(', ')}`,
      );
    }
  }
});

test('topologicalOrder is deterministic for independent tasks', () => {
  const order = topologicalOrder([task('x'), task('y'), task('z')]);
  assert.deepEqual(order, ['x', 'y', 'z']);
});

test('topologicalOrder throws on a cycle', () => {
  assert.throws(() => topologicalOrder([task('a', 'b'), task('b', 'a')]), /cycle/);
});

test('transitiveDependents returns direct and indirect dependents only', () => {
  const tasks = [
    task('a'),
    task('b', 'a'),
    task('c', 'b'),
    task('d', 'b', 'x'),
    task('x'),
    task('unrelated'),
  ];
  assert.deepEqual([...transitiveDependents(tasks, 'a')].sort(), ['b', 'c', 'd']);
  assert.deepEqual([...transitiveDependents(tasks, 'x')], ['d']);
  assert.deepEqual([...transitiveDependents(tasks, 'unrelated')], []);
});
