import Redis from 'ioredis';
import { config, EVENTS_CHANNEL } from './config.js';

export function createRedis() {
  return new Redis(config.redisUrl, { maxRetriesPerRequest: null });
}

// Tell the API (and through it, browsers) that a run or task changed.
// Events are only a hint to refetch; the database stays the source of truth.
export async function publishEvent(redis, event) {
  try {
    await redis.publish(EVENTS_CHANNEL, JSON.stringify(event));
  } catch (error) {
    // A lost notification must never fail a run; clients also refetch on reconnect.
    console.error('Failed to publish event:', error.message);
  }
}
