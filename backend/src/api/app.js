import Fastify from 'fastify';
import cors from '@fastify/cors';
import pipelineRoutes from './routes/pipelines.js';

export async function buildApp() {
  const app = Fastify({ logger: true });

  // The browser talks to the API directly (including the event stream).
  await app.register(cors, { origin: true });

  // Return a consistent JSON error shape; never leak internals for unexpected errors.
  app.setErrorHandler((error, request, reply) => {
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(pipelineRoutes);

  return app;
}
