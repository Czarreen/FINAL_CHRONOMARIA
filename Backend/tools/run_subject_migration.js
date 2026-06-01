import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), 'Backend', '.env') });

const SQL_PATH = path.resolve(process.cwd(), 'Backend', 'migrations', '002_add_subject_notifications.sql');

async function main() {
  const sql = fs.readFileSync(SQL_PATH, 'utf8');

  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    console.log('Connecting to database...');
    await client.connect();

    console.log('Running migration SQL...');
    await client.query(sql);
    console.log('Migration executed. Running backfill...');
    const res = await client.query('SELECT public.refresh_all_subject_notifications();');
    console.log('Backfill completed:', res.command || res.rows);
  } catch (err) {
    console.error('Migration error:', err.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
