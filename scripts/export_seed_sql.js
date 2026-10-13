import fs from 'fs';
import { pool } from '../server/src/db/index.js';

async function exportSeedSql() {
  const client = await pool.connect();
  try {
    let sql = '-- ==============================================================================\n';
    sql += '-- ValetTrack: Pure SQL Seed Script\n';
    sql += '-- Facility configuration only (zero synthetic customer records or mock predictions)\n';
    sql += '-- ==============================================================================\n\n';
    sql += 'BEGIN;\n\n';

    sql += '-- 1. Slot Types\n';
    const st = await client.query('SELECT * FROM slot_types ORDER BY slot_type_id');
    for (const r of st.rows) {
      sql += `INSERT INTO slot_types (slot_type_id, type_name, base_rate) VALUES (${r.slot_type_id}, '${r.type_name}', ${r.base_rate}) ON CONFLICT (slot_type_id) DO UPDATE SET type_name = EXCLUDED.type_name, base_rate = EXCLUDED.base_rate;\n`;
    }

    sql += '\n-- 2. Parking Slots\n';
    const ps = await client.query('SELECT * FROM parking_slots ORDER BY slot_id');
    for (const r of ps.rows) {
      sql += `INSERT INTO parking_slots (slot_id, slot_type_id, status) VALUES (${r.slot_id}, ${r.slot_type_id}, 'Available') ON CONFLICT (slot_id) DO UPDATE SET slot_type_id = EXCLUDED.slot_type_id, status = CASE WHEN EXISTS (SELECT 1 FROM tickets WHERE slot_id = EXCLUDED.slot_id AND exit_time IS NULL) THEN 'Occupied' ELSE parking_slots.status END;\n`;
    }

    sql += '\nCOMMIT;\n';

    fs.writeFileSync('sql/seed.sql', sql);
    console.log('Successfully updated sql/seed.sql with clean facility configuration.');
  } finally {
    client.release();
    await pool.end();
  }
}

exportSeedSql().catch(console.error);
