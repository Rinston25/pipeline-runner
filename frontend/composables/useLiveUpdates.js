// Subscribes to the API's Server-Sent Events stream while the calling component is mounted.
// `onEvent` receives each parsed event, plus { type: 'resync' } after a dropped connection
// is restored, because events sent during the gap were missed.
export function useLiveUpdates(onEvent) {
  const { apiBase } = useRuntimeConfig().public;
  const connected = ref(false);
  let source = null;
  let wasDisconnected = false;

  onMounted(() => {
    source = new EventSource(`${apiBase}/api/events`);
    source.onopen = () => {
      connected.value = true;
      if (wasDisconnected) onEvent({ type: 'resync' });
      wasDisconnected = false;
    };
    source.onmessage = (message) => onEvent(JSON.parse(message.data));
    // EventSource reconnects by itself; we only record that it happened.
    source.onerror = () => {
      connected.value = false;
      wasDisconnected = true;
    };
  });

  onBeforeUnmount(() => source?.close());

  return { connected };
}
