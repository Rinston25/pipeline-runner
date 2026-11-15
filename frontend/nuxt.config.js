// The app is a single-page app: data comes from the API in the browser, and the live
// event stream only exists client-side, so server rendering would add nothing.
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'Pipeline Runner',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  runtimeConfig: {
    public: {
      // The browser calls the API directly. Override with NUXT_PUBLIC_API_BASE.
      apiBase: 'http://localhost:3001',
    },
  },
});
