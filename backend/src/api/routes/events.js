import { EVENTS_CHANNEL } from '../../config.js';

const KEEP_ALIVE_MS = 15000;

// Server-Sent Events: the worker publishes run/task changes to a Redis channel, this process
// subscribes once and forwards every message to all connected browsers.
export default async function eventRoutes(app, { subscriber }) {
  const clients = new Set(); // raw Node responses of connected browsers

  await subscriber.subscribe(EVENTS_CHANNEL);
  subscriber.on('message', (channel, message) => {
    for (const client of clients) client.write(`data: ${message}\n\n`);
  });

  // Comment lines keep idle connections from being closed by proxies.
  const keepAlive = setInterval(() => {
    for (const client of clients) client.write(': keep-alive\n\n');
  }, KEEP_ALIVE_MS);

  app.addHook('onClose', async () => {
    clearInterval(keepAlive);
    for (const client of clients) client.end();
  });

  app.get('/api/events', (request, reply) => {
    // Take over the socket: Fastify must not try to send a normal reply.
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Hijacked replies skip the CORS plugin, so allow the browser explicitly.
      'Access-Control-Allow-Origin': request.headers.origin || '*',
    });
    // Browsers reconnect automatically after this delay if the connection drops.
    response.write('retry: 2000\n\n');

    clients.add(response);
    request.raw.on('close', () => clients.delete(response));
  });
}
