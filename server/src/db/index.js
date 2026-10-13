import pg from 'pg';
import { config } from '../config/env.js';

const { Pool } = pg;

export const pool = new Pool(config.db);

pool.on('error', (err) => {
  console.error('[Database Pool Error]: Unexpected error on idle client', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (config.nodeEnv === 'development' && duration > 100) {
    console.debug(`[Slow Query] ${duration}ms: ${text.slice(0, 100)}`);
  }
  return res;
}

export async function getClient() {
  const client = await pool.connect();
  return client;
}

export async function checkDbHealth() {
  try {
    const res = await query('SELECT 1 as healthy, version() as version;');
    return {
      connected: true,
      status: 'healthy',
      version: res.rows[0].version
    };
  } catch (err) {
    return {
      connected: false,
      status: 'unhealthy',
      error: err.message
    };
  }
}
