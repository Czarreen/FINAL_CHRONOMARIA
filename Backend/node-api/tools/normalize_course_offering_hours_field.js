import { supabaseAdmin } from '../src/lib/supabase.js';

async function run() {
  const { data: rows, error: fetchErr } = await supabaseAdmin
    .from('data_quality_notifications')
    .select('id, field_name, message')
    .eq('entity_type', 'course_offering')
    .eq('issue_type', 'missing')
    .eq('field_name', 'lec_hrs');

  if (fetchErr) {
    console.error('Failed to fetch rows for normalization:', fetchErr.message || fetchErr);
    process.exit(1);
  }

  const ids = (rows || []).map((row) => row.id).filter(Boolean);
  if (ids.length === 0) {
    console.log('No lec_hrs rows found for normalization.');
    return;
  }

  const now = new Date().toISOString();
  const BATCH_SIZE = 200;
  let updated = 0;

  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const { error: updateErr } = await supabaseAdmin
      .from('data_quality_notifications')
      .update({
        field_name: 'hours',
        message: 'Either lecture hours or lab hours must be specified',
        updated_at: now,
      })
      .in('id', batch);

    if (updateErr) {
      console.error(`Failed to normalize batch starting at offset ${index}:`, updateErr.message || updateErr);
      process.exit(1);
    }

    updated += batch.length;
  }

  console.log(`Normalized ${updated} notification row(s) from lec_hrs to hours.`);
}

run().catch((err) => {
  console.error('Normalization failed:', err?.message || err);
  process.exit(1);
});
