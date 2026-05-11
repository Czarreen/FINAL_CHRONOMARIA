import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

const pool = new Pool({
  host: env.dbHost,
  port: env.dbPort,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  ssl: env.dbSsl ? { rejectUnauthorized: false } : false,
  max: 4,
});

pool.on('error', (error) => {
  console.error('[postgres] pool error:', error);
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function withPgClient(work) {
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export default pool;