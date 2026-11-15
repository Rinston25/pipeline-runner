export function formatDuration(milliseconds) {
  if (milliseconds === null || milliseconds === undefined) return '-';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

export function formatTime(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleTimeString();
}

export function formatDateTime(isoString) {
  if (!isoString) return '-';
  return new Date(isoString).toLocaleString();
}
