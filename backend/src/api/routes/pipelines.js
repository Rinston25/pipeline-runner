import { createPipeline, getPipeline, listPipelines } from '../../db/pipelines.js';

const taskSchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    durationMs: { type: 'integer', minimum: 0, maximum: 600000, default: 1000 },
    shouldFail: { type: 'boolean', default: false },
    dependsOn: { type: 'array', items: { type: 'string' }, default: [] },
  },
};

const createPipelineSchema = {
  body: {
    type: 'object',
    required: ['name', 'tasks'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 100 },
      tasks: { type: 'array', minItems: 1, maxItems: 200, items: taskSchema },
    },
  },
};

const idParamsSchema = {
  params: {
    type: 'object',
    properties: { id: { type: 'string', format: 'uuid' } },
  },
};

export default async function pipelineRoutes(app) {
  app.get('/api/pipelines', async () => listPipelines());

  app.get('/api/pipelines/:id', { schema: idParamsSchema }, async (request, reply) => {
    const pipeline = await getPipeline(request.params.id);
    if (!pipeline) return reply.code(404).send({ error: 'Pipeline not found' });
    return pipeline;
  });

  app.post('/api/pipelines', { schema: createPipelineSchema }, async (request, reply) => {
    const body = request.body;
    const pipelineId = await createPipeline({
      name: body.name.trim(),
      tasks: body.tasks.map((task) => ({ ...task, name: task.name.trim() })),
    });
    return reply.code(201).send(await getPipeline(pipelineId));
  });
}
