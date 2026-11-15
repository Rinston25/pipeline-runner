import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

// Run several statements in one transaction; rolls back if the callback throws.
export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
