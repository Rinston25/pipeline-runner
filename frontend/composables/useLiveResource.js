// Loads data with `fetcher` and reloads it whenever a relevant live event arrives.
// `isRelevant(event)` decides which events should trigger a reload.
export function useLiveResource(fetcher, isRelevant = () => true) {
  const data = ref(null);
  const error = ref(null);
  const loading = ref(true);
  let latestRequest = 0;
  let reloadTimer = null;

  async function load() {
    const thisRequest = ++latestRequest;
    try {
      const result = await fetcher();
      // Ignore a slow response that was overtaken by a newer request.
      if (thisRequest !== latestRequest) return;
      data.value = result;
      error.value = null;
    } catch (failure) {
      if (thisRequest === latestRequest) error.value = failure.message;
    } finally {
      if (thisRequest === latestRequest) loading.value = false;
    }
  }

  // A run emits a burst of events; wait briefly and reload once.
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 100);
  }

  const { connected } = useLiveUpdates((event) => {
    if (event.type === 'resync' || isRelevant(event)) scheduleReload();
  });

  onMounted(load);
  onBeforeUnmount(() => clearTimeout(reloadTimer));

  return { data, error, loading, connected, reload: load };
}
