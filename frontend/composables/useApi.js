// Small wrapper around $fetch that talks to the API and turns failures into readable errors.
export async function apiRequest(path, options = {}) {
  const { apiBase } = useRuntimeConfig().public;
  try {
    return await $fetch(path, { baseURL: apiBase, ...options });
  } catch (error) {
    const message = error.data?.error || error.message || 'Request failed';
    const failure = new Error(message);
    failure.details = error.data?.details || [];
    throw failure;
  }
}
