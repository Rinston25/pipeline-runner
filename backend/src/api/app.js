import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createRedis } from '../redis.js';
import pipelineRoutes from './routes/pipelines.js';
import eventRoutes from './routes/events.js';
import runRoutes from './routes/runs.js';

export async function buildApp() {
  const app = Fastify({ logger: true });
  const redis = createRedis();
  // A connection in subscribe mode cannot run other commands, so events get their own.
  const subscriber = createRedis();
  app.addHook('onClose', async () => {
    redis.disconnect();
    subscriber.disconnect();
  });

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
  await app.register(runRoutes, { redis });
  await app.register(eventRoutes, { subscriber });

  return app;
}
