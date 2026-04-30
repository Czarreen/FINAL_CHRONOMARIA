import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

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
};
