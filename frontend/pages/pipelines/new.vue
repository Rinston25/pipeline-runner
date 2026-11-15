<script setup>
// Pipeline creation form. Rows are tracked by a private key so that renaming a task does
// not break the dependencies other tasks have on it; names are resolved on submit.
let nextKey = 1;
const newRow = (fields = {}) => ({
  key: nextKey++,
  name: '',
  durationSeconds: 1,
  shouldFail: false,
  dependsOn: [], // keys of other rows
  ...fields,
});

const pipelineName = ref('');
const rows = ref([newRow()]);
const submitting = ref(false);
const errorMessage = ref(null);
const errorDetails = ref([]);

function addRow() {
  rows.value.push(newRow());
}

function removeRow(row) {
  rows.value = rows.value.filter((other) => other.key !== row.key);
  // Nobody may keep depending on a row that no longer exists.
  for (const other of rows.value) {
    other.dependsOn = other.dependsOn.filter((key) => key !== row.key);
  }
}

function toggleDependency(row, otherKey, checked) {
  row.dependsOn = checked
    ? [...row.dependsOn, otherKey]
    : row.dependsOn.filter((key) => key !== otherKey);
}

// Pre-fills a small diamond-shaped pipeline so the parallelism is easy to see.
function loadExample() {
  const checkout = newRow({ name: 'checkout', durationSeconds: 1 });
  const lint = newRow({ name: 'lint', durationSeconds: 2, dependsOn: [checkout.key] });
  const tests = newRow({ name: 'unit-tests', durationSeconds: 3, dependsOn: [checkout.key] });
  const build = newRow({ name: 'build', durationSeconds: 2, dependsOn: [lint.key, tests.key] });
  const deploy = newRow({ name: 'deploy', durationSeconds: 1, dependsOn: [build.key] });
  pipelineName.value = 'Build and deploy';
  rows.value = [checkout, lint, tests, build, deploy];
}

async function submit() {
  errorMessage.value = null;
  errorDetails.value = [];

  const nameByKey = new Map(rows.value.map((row) => [row.key, row.name.trim()]));
  const body = {
    name: pipelineName.value.trim(),
    tasks: rows.value.map((row) => ({
      name: row.name.trim(),
      durationMs: Math.round(Number(row.durationSeconds) * 1000),
      shouldFail: row.shouldFail,
      dependsOn: row.dependsOn.map((key) => nameByKey.get(key)).filter(Boolean),
    })),
  };

  submitting.value = true;
  try {
    const created = await apiRequest('/api/pipelines', { method: 'POST', body });
    await navigateTo(`/pipelines/${created.id}`);
  } catch (failure) {
    errorMessage.value = failure.message;
    errorDetails.value = failure.details;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>New pipeline</h1>
      <button type="button" class="button button-secondary button-small" @click="loadExample">
        Load example
      </button>
    </div>

    <form class="card card-body" @submit.prevent="submit">
      <div v-if="errorMessage" class="banner banner-failed">
        {{ errorMessage }}
        <ul v-if="errorDetails.length > 0">
          <li v-for="detail in errorDetails" :key="detail">{{ detail }}</li>
        </ul>
      </div>

      <label for="pipeline-name">Pipeline name</label>
      <input id="pipeline-name" v-model="pipelineName" type="text" required maxlength="100" />

      <h2>Tasks</h2>
      <div v-for="(row, index) in rows" :key="row.key" class="task-row">
        <div class="task-fields">
          <div>
            <label :for="`task-name-${row.key}`">Task {{ index + 1 }} name</label>
            <input :id="`task-name-${row.key}`" v-model="row.name" type="text" required maxlength="100" />
          </div>
          <div>
            <label :for="`task-duration-${row.key}`">Duration (seconds)</label>
            <input
              :id="`task-duration-${row.key}`"
              v-model="row.durationSeconds"
              type="number"
              min="0"
              max="600"
              step="0.1"
              required
            />
          </div>
          <label class="checkbox">
            <input v-model="row.shouldFail" type="checkbox" />
            Force failure
          </label>
          <button
            type="button"
            class="button button-secondary button-small"
            :disabled="rows.length === 1"
            @click="removeRow(row)"
          >
            Remove
          </button>
        </div>

        <div v-if="rows.length > 1" class="dependencies">
          <span class="muted">Runs after:</span>
          <template v-for="other in rows" :key="other.key">
            <label v-if="other.key !== row.key" class="checkbox">
              <input
                type="checkbox"
                :checked="row.dependsOn.includes(other.key)"
                @change="toggleDependency(row, other.key, $event.target.checked)"
              />
              {{ other.name.trim() || `Task ${rows.indexOf(other) + 1}` }}
            </label>
          </template>
        </div>
      </div>

      <button type="button" class="button button-secondary" @click="addRow">Add task</button>

      <div class="form-actions">
        <button type="submit" class="button" :disabled="submitting">Create pipeline</button>
        <NuxtLink to="/" class="button button-secondary">Cancel</NuxtLink>
      </div>
    </form>
  </div>
</template>
