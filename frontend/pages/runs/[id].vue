<script setup>
// Run inspection: the state of every task, timings, and what went wrong. Updates live.
const route = useRoute();
const runId = route.params.id;

const { data: run, error, loading, connected } = useLiveResource(
  () => apiRequest(`/api/runs/${runId}`),
  (event) => event.runId === runId,
);

// Ticks so durations of still-running tasks keep counting up.
const now = ref(Date.now());
let ticker = null;
onMounted(() => {
  ticker = setInterval(() => {
    now.value = Date.now();
  }, 500);
});
onBeforeUnmount(() => clearInterval(ticker));

function taskDuration(task) {
  if (task.status === 'running' && task.startedAt) {
    return formatDuration(Math.max(0, now.value - new Date(task.startedAt).getTime()));
  }
  return formatDuration(task.elapsedMs);
}

const runDuration = computed(() => {
  if (!run.value?.startedAt) return '-';
  if (run.value.durationMs !== null) return formatDuration(run.value.durationMs);
  return formatDuration(Math.max(0, now.value - new Date(run.value.startedAt).getTime()));
});

const count = (status) => run.value?.tasks.filter((task) => task.status === status).length ?? 0;
const finishedCount = computed(
  () => count('success') + count('failed') + count('skipped'),
);
const failedTasks = computed(() => run.value?.tasks.filter((task) => task.status === 'failed') ?? []);
const isActive = computed(() => run.value && ['queued', 'running'].includes(run.value.status));
</script>

<template>
  <div>
    <p class="breadcrumb">
      <NuxtLink v-if="run" :to="`/pipelines/${run.pipelineId}`">&larr; {{ run.pipelineName }}</NuxtLink>
      <NuxtLink v-else to="/">&larr; All pipelines</NuxtLink>
    </p>
    <div v-if="error" class="banner banner-failed">{{ error }}</div>
    <p v-if="loading" class="muted">Loading...</p>

    <template v-if="run">
      <div class="page-header">
        <h1>Run <span class="muted">{{ run.id.slice(0, 8) }}</span> <StatusBadge :status="run.status" /></h1>
        <LiveIndicator :connected="connected" />
      </div>

      <div v-if="run.status === 'failed'" class="banner banner-failed">
        <strong>This run failed.</strong>
        <div v-if="run.error">{{ run.error }}</div>
        <ul>
          <li v-for="task in failedTasks" :key="task.name">
            <strong>{{ task.name }}</strong>: {{ task.error }}
          </li>
          <li v-if="count('skipped') > 0">
            {{ count('skipped') }} task(s) were skipped and did not run.
          </li>
        </ul>
      </div>
      <div v-else-if="run.status === 'success'" class="banner banner-success">
        All {{ run.tasks.length }} tasks succeeded.
      </div>
      <div v-else-if="isActive" class="banner banner-info">
        {{ finishedCount }} of {{ run.tasks.length }} tasks finished.
      </div>

      <dl class="card summary">
        <div><dt>Queued</dt><dd>{{ formatDateTime(run.createdAt) }}</dd></div>
        <div><dt>Started</dt><dd>{{ formatDateTime(run.startedAt) }}</dd></div>
        <div><dt>Finished</dt><dd>{{ formatDateTime(run.finishedAt) }}</dd></div>
        <div><dt>Duration</dt><dd>{{ runDuration }}</dd></div>
      </dl>

      <h2>Tasks</h2>
      <div class="card">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th>Status</th>
              <th>Runs after</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Duration</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="task in run.tasks" :key="task.name">
              <td>{{ task.name }}</td>
              <td><StatusBadge :status="task.status" /></td>
              <td class="muted">{{ task.dependsOn.join(', ') || '-' }}</td>
              <td>{{ formatTime(task.startedAt) }}</td>
              <td>{{ formatTime(task.finishedAt) }}</td>
              <td>{{ taskDuration(task) }}</td>
              <td class="error-text">{{ task.error }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
