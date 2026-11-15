<script setup>
// Pipeline list: every pipeline with the status of its latest run, updated live.
const { data: pipelines, error, loading, connected } = useLiveResource(() =>
  apiRequest('/api/pipelines'),
);

const startingIds = ref(new Set()); // pipelines whose run request is in flight
const actionError = ref(null);

async function runPipeline(pipeline) {
  actionError.value = null;
  startingIds.value = new Set(startingIds.value).add(pipeline.id);
  try {
    // The list refreshes itself through the live event stream.
    await apiRequest(`/api/pipelines/${pipeline.id}/runs`, { method: 'POST' });
  } catch (failure) {
    actionError.value = `Could not start "${pipeline.name}": ${failure.message}`;
  } finally {
    const remaining = new Set(startingIds.value);
    remaining.delete(pipeline.id);
    startingIds.value = remaining;
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <h1>Pipelines</h1>
      <div class="actions">
        <LiveIndicator :connected="connected" />
      </div>
    </div>

    <div v-if="error" class="banner banner-failed">Could not load pipelines: {{ error }}</div>
    <div v-if="actionError" class="banner banner-failed">{{ actionError }}</div>

    <div class="card">
      <p v-if="loading" class="empty">Loading...</p>
      <p v-else-if="pipelines && pipelines.length === 0" class="empty">
        No pipelines yet. <NuxtLink to="/pipelines/new">Create your first one.</NuxtLink>
      </p>
      <table v-else-if="pipelines">
        <thead>
          <tr>
            <th>Pipeline</th>
            <th>Tasks</th>
            <th>Latest run</th>
            <th>Last activity</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="pipeline in pipelines" :key="pipeline.id">
            <td>
              <NuxtLink :to="`/pipelines/${pipeline.id}`">{{ pipeline.name }}</NuxtLink>
            </td>
            <td>{{ pipeline.taskCount }}</td>
            <td>
              <StatusBadge :status="pipeline.latestRun?.status" />
              <NuxtLink v-if="pipeline.latestRun" :to="`/runs/${pipeline.latestRun.id}`" class="muted">
                details
              </NuxtLink>
            </td>
            <td class="muted">
              {{ formatDateTime(pipeline.latestRun?.finishedAt || pipeline.latestRun?.startedAt || pipeline.latestRun?.createdAt) }}
            </td>
            <td>
              <button
                class="button button-small"
                :disabled="startingIds.has(pipeline.id)"
                @click="runPipeline(pipeline)"
              >
                Run
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
