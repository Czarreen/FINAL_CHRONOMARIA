import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT || 5000),
  supabaseUrl: getRequiredEnv('SUPABASE_URL'),
  supabaseServiceRoleKey: getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  dbHost: getRequiredEnv('DB_HOST'),
  dbPort: Number(process.env.DB_PORT || 5432),
  dbUser: getRequiredEnv('DB_USER'),
  dbPassword: getRequiredEnv('DB_PASSWORD'),
  dbName: process.env.DB_NAME || 'postgres',
  dbSsl: String(process.env.DB_SSL || 'false').toLowerCase() === 'true',
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000',
  gaRequestTimeoutMs: Number(process.env.GA_REQUEST_TIMEOUT_MS || 180000),
};
