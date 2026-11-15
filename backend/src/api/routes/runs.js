import { QUEUE_KEY } from '../../config.js';
import { createRun, getRun, listRuns } from '../../db/runs.js';
import { getPipeline } from '../../db/pipelines.js';
import { publishEvent } from '../../redis.js';

const idParamsSchema = {
  params: {
    type: 'object',
    properties: { id: { type: 'string', format: 'uuid' } },
  },
};

export default async function runRoutes(app, { redis }) {
  // Queue a new execution of a pipeline. Returns immediately; a worker does the work.
  app.post('/api/pipelines/:id/runs', { schema: idParamsSchema }, async (request, reply) => {
    const runId = await createRun(request.params.id);
    if (!runId) return reply.code(404).send({ error: 'Pipeline not found' });

    // Announce before enqueueing so "queued" is always seen before "running".
    const run = await getRun(runId);
    await publishEvent(redis, {
      type: 'run.updated',
      runId,
      pipelineId: run.pipelineId,
      status: 'queued',
    });

    // The run is already saved. If Redis is down right now the run stays "queued" and the
    // worker's recovery sweep pushes it onto the queue later, so we still accept the request.
    try {
      await redis.lpush(QUEUE_KEY, runId);
    } catch (error) {
      request.log.error(error, 'Could not enqueue run; recovery will retry');
    }

    return reply.code(202).send(run);
  });

  app.get('/api/pipelines/:id/runs', { schema: idParamsSchema }, async (request, reply) => {
    if (!(await getPipeline(request.params.id))) {
      return reply.code(404).send({ error: 'Pipeline not found' });
    }
    return listRuns(request.params.id);
  });

  app.get('/api/runs/:id', { schema: idParamsSchema }, async (request, reply) => {
    const run = await getRun(request.params.id);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return run;
  });
}
