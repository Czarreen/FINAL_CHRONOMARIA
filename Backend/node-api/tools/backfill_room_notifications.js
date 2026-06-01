import { supabaseAdmin } from '../src/lib/supabase.js';

async function buildNotificationForRoom(r) {
  const missingFields = [];
  const issues = [];

  if (!r.room_name || String(r.room_name).trim() === '') {
    missingFields.push('room_name');
    issues.push({ message: 'Missing room name' });
  }

  if (!r.room_type || String(r.room_type).trim() === '') {
    missingFields.push('room_type');
    issues.push({ message: 'Missing room type' });
  }

  if (!r.room_status || String(r.room_status).trim() === '') {
    missingFields.push('room_status');
    issues.push({ message: 'Missing room status' });
  }

  const severity = missingFields.length > 0 ? 'critical' : 'low';

  return {
    room_id: r.room_id,
    title: r.room_name || `Room #${r.room_id}`,
    description: r.room_type || null,
    severity,
    missing_fields: JSON.stringify(missingFields),
    issues: JSON.stringify(issues),
    metadata: JSON.stringify({}),
  };
}

async function run() {
  console.log('Fetching room rows...');
  const { data: roomRows, error } = await supabaseAdmin
    .from('rooms')
    .select('room_id, room_name, room_type, room_status');

  if (error) {
    console.error('Failed to fetch rooms:', error);
    process.exit(1);
  }

  const inserts = [];
  for (const r of roomRows || []) {
    const n = await buildNotificationForRoom(r);
    // only persist items that have missing fields or issues (i.e., need attention)
    const missing = JSON.parse(n.missing_fields || '[]');
    const issues = JSON.parse(n.issues || '[]');
    if (missing.length === 0 && issues.length === 0) continue;
    inserts.push(n);
  }

  console.log(`Preparing to upsert ${inserts.length} notifications into room_notifications...`);

  // preserve existing is_resolved flags: fetch existing notifications for these room_ids
  const roomIds = inserts.map((i) => i.room_id);
  let existingMap = {};
  if (roomIds.length > 0) {
    const { data: existingRows, error: fetchErr } = await supabaseAdmin
      .from('room_notifications')
      .select('*')
      .in('room_id', roomIds);

    if (fetchErr) {
      console.error('Failed to fetch existing notifications:', fetchErr);
      process.exit(1);
    }

    existingMap = (existingRows || []).reduce((acc, row) => {
      acc[row.room_id] = row;
      return acc;
    }, {});
  }

  // merge is_resolved from existing rows when present
  const toUpsert = inserts.map((item) => {
    const existing = existingMap[item.room_id];
    return {
      ...item,
      is_resolved: existing && existing.is_resolved ? true : false,
      updated_at: new Date().toISOString(),
    };
  });

  if (toUpsert.length === 0) {
    console.log('No notifications to upsert. Backfill complete.');
    return;
  }

  const { data, error: upsertErr } = await supabaseAdmin
    .from('room_notifications')
    .upsert(toUpsert, { onConflict: 'room_id' });

  if (upsertErr) {
    console.error('Upsert failed:', upsertErr);
    process.exit(1);
  }

  // Delete rows for rooms that don't have any issues
  const roomIdsWithProblems = new Set(inserts.map((i) => i.room_id));
  const allRoomIds = new Set((roomRows || []).map((f) => f.room_id));
  const roomIdsWithoutProblems = Array.from(allRoomIds).filter((id) => !roomIdsWithProblems.has(id));

  if (roomIdsWithoutProblems.length > 0) {
    console.log(`Deleting ${roomIdsWithoutProblems.length} notifications for rooms with no issues...`);
    const { error: deleteErr } = await supabaseAdmin
      .from('room_notifications')
      .delete()
      .in('room_id', roomIdsWithoutProblems);

    if (deleteErr) {
      console.error('Delete failed:', deleteErr);
      process.exit(1);
    }
    console.log(`Deleted ${roomIdsWithoutProblems.length} notifications.`);
  }

  console.log('Backfill complete.');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
