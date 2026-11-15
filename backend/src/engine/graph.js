// Pure helpers for task graphs. A task is { name, dependsOn: [names of other tasks] }.
// Names are the keys because they are unique within a pipeline.

// Returns a list of human-readable problems; an empty list means the graph is valid.
export function validateTasks(tasks) {
  const problems = [];

  const seenNames = new Set();
  for (const task of tasks) {
    if (seenNames.has(task.name)) problems.push(`Duplicate task name "${task.name}"`);
    seenNames.add(task.name);
  }

  for (const task of tasks) {
    const seenDependencies = new Set();
    for (const dependency of task.dependsOn) {
      if (dependency === task.name) {
        problems.push(`Task "${task.name}" cannot depend on itself`);
      } else if (!seenNames.has(dependency)) {
        problems.push(`Task "${task.name}" depends on unknown task "${dependency}"`);
      } else if (seenDependencies.has(dependency)) {
        problems.push(`Task "${task.name}" lists dependency "${dependency}" more than once`);
      }
      seenDependencies.add(dependency);
    }
  }

  // Cycle detection only makes sense once every reference points at a real task.
  if (problems.length === 0) {
    const cycle = findCycle(tasks);
    if (cycle) problems.push(`Dependency cycle: ${cycle.join(' -> ')}`);
  }
  return problems;
}

// Depth-first search; returns one cycle as [a, b, c, a], or null if the graph is acyclic.
export function findCycle(tasks) {
  const dependenciesByName = new Map(tasks.map((task) => [task.name, task.dependsOn]));
  const finished = new Set(); // fully explored, known to be cycle-free
  const path = []; // tasks on the current DFS stack

  function visit(name) {
    const indexOnPath = path.indexOf(name);
    if (indexOnPath !== -1) return [...path.slice(indexOnPath), name];
    if (finished.has(name)) return null;

    path.push(name);
    for (const dependency of dependenciesByName.get(name)) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    finished.add(name);
    return null;
  }

  for (const task of tasks) {
    const cycle = visit(task.name);
    if (cycle) return cycle;
  }
  return null;
}

// Task names ordered so every task comes after all of its dependencies (Kahn's algorithm).
// Ties are broken by input order, so the result is deterministic.
export function topologicalOrder(tasks) {
  const unmetDependencies = new Map(tasks.map((task) => [task.name, task.dependsOn.length]));
  const dependentsByName = new Map(tasks.map((task) => [task.name, []]));
  for (const task of tasks) {
    for (const dependency of task.dependsOn) dependentsByName.get(dependency).push(task.name);
  }

  const ready = tasks.filter((task) => task.dependsOn.length === 0).map((task) => task.name);
  const order = [];
  while (ready.length > 0) {
    const name = ready.shift();
    order.push(name);
    for (const dependent of dependentsByName.get(name)) {
      unmetDependencies.set(dependent, unmetDependencies.get(dependent) - 1);
      if (unmetDependencies.get(dependent) === 0) ready.push(dependent);
    }
  }

  if (order.length !== tasks.length) throw new Error('Task graph contains a cycle');
  return order;
}

// Every task that directly or indirectly depends on `name`.
export function transitiveDependents(tasks, name) {
  const dependentsByName = new Map(tasks.map((task) => [task.name, []]));
  for (const task of tasks) {
    for (const dependency of task.dependsOn) dependentsByName.get(dependency).push(task.name);
  }

  const found = new Set();
  const toVisit = [name];
  while (toVisit.length > 0) {
    for (const dependent of dependentsByName.get(toVisit.pop())) {
      if (!found.has(dependent)) {
        found.add(dependent);
        toVisit.push(dependent);
      }
    }
  }
  return found;
}
