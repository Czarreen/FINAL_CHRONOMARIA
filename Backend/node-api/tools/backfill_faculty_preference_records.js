import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';

const { Client } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });

const client = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function run() {
  await client.connect();
  console.log('Connected to DB. Backfilling faculty_preference_records...');

  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS faculty_preference_records (
        id BIGSERIAL PRIMARY KEY,
        faculty_id INTEGER NOT NULL,
        subject_tag TEXT NOT NULL,
        priority_level INTEGER NOT NULL DEFAULT 2,
        source_table TEXT NOT NULL DEFAULT 'faculty_subject_tags',
        record_action TEXT NOT NULL DEFAULT 'upsert',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const dedupeResult = await client.query(`
      DELETE FROM faculty_preference_records fpr
      USING faculty_preference_records keep_row
      WHERE fpr.faculty_id = keep_row.faculty_id
        AND fpr.subject_tag = keep_row.subject_tag
        AND (
          fpr.created_at < keep_row.created_at
          OR (fpr.created_at = keep_row.created_at AND fpr.id < keep_row.id)
        );
    `);

    const backfillResult = await client.query(`
      INSERT INTO faculty_preference_records (
        faculty_id,
        subject_tag,
        priority_level,
        source_table,
        record_action,
        created_at
      )
      SELECT
        fst.faculty_id,
        fst.subject_tag,
        fst.priority_level,
        'faculty_subject_tags' AS source_table,
        'backfill' AS record_action,
        COALESCE(fst.created_at, NOW()) AS created_at
      FROM faculty_subject_tags fst
      WHERE NOT EXISTS (
        SELECT 1
        FROM faculty_preference_records fpr
        WHERE fpr.faculty_id = fst.faculty_id
          AND fpr.subject_tag = fst.subject_tag
          AND fpr.source_table = 'faculty_subject_tags'
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS faculty_preference_records_faculty_subject_tag_uidx
        ON faculty_preference_records (faculty_id, subject_tag);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS faculty_preference_records_faculty_id_idx
        ON faculty_preference_records (faculty_id, created_at DESC, id DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS faculty_preference_records_subject_tag_idx
        ON faculty_preference_records (subject_tag);
    `);

    await client.query('COMMIT');

    console.log(`Removed ${dedupeResult.rowCount} duplicate archive row(s).`);
    console.log(`Backfilled ${backfillResult.rowCount} record(s) from faculty_subject_tags.`);
    console.log('Backfill complete.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});