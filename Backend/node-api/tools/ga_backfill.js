import { runFacultyLoadingBackfill } from '../src/controllers/gaController.js';

async function main() {
  const result = await runFacultyLoadingBackfill();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[ga_backfill] failed:', error);
  process.exitCode = 1;
});