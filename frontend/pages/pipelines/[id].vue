<script setup>
// One pipeline: its definition, a Run button, and the history of its runs (live).
const route = useRoute();
const pipelineId = route.params.id;

const { data, error, loading, connected } = useLiveResource(
  async () => {
    const [pipeline, runs] = await Promise.all([
      apiRequest(`/api/pipelines/${pipelineId}`),
      apiRequest(`/api/pipelines/${pipelineId}/runs`),
    ]);
    return { pipeline, runs };
  },
  (event) => event.pipelineId === pipelineId,
);

const starting = ref(false);
const actionError = ref(null);

async function startRun() {
  starting.value = true;
  actionError.value = null;
  try {
    const run = await apiRequest(`/api/pipelines/${pipelineId}/runs`, { method: 'POST' });
    await navigateTo(`/runs/${run.id}`);
  } catch (failure) {
    actionError.value = failure.message;
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <div>
    <p class="breadcrumb"><NuxtLink to="/">&larr; All pipelines</NuxtLink></p>
    <div v-if="error" class="banner banner-failed">{{ error }}</div>
    <p v-if="loading" class="muted">Loading...</p>

    <template v-if="data">
      <div class="page-header">
        <h1>{{ data.pipeline.name }}</h1>
        <div class="actions">
          <LiveIndicator :connected="connected" />
          <button class="button" :disabled="starting" @click="startRun">Run pipeline</button>
        </div>
      </div>
      <div v-if="actionError" class="banner banner-failed">{{ actionError }}</div>

      <h2>Tasks</h2>
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Runs after</th>
              <th>Duration</th>
              <th>Forced failure</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in data.pipeline.tasks" :key="task.id">
              <td>{{ task.name }}</td>
              <td>{{ task.dependsOn.length > 0 ? task.dependsOn.join(', ') : 'nothing (starts immediately)' }}</td>
              <td>{{ formatDuration(task.durationMs) }}</td>
              <td>{{ task.shouldFail ? 'yes' : 'no' }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Runs</h2>
      <div class="card">
        <p v-if="data.runs.length === 0" class="empty">This pipeline has not run yet.</p>
        <table v-else>
          <thead>
            <tr>
              <th>Status</th>
              <th>Queued</th>
              <th>Duration</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in data.runs" :key="run.id">
              <td><StatusBadge :status="run.status" /></td>
              <td>{{ formatDateTime(run.createdAt) }}</td>
              <td>{{ formatDuration(run.durationMs) }}</td>
              <td><NuxtLink :to="`/runs/${run.id}`">Inspect</NuxtLink></td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
