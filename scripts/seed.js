import { pool } from '../server/src/db/index.js';

export async function safeSeed() {
  console.log('--- Initializing ValetTrack Facility Configuration (Safe Seed) ---');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('1. Configuring Slot Types (Idempotent upsert)...');
    await client.query(`
      INSERT INTO slot_types (slot_type_id, type_name, base_rate) VALUES
        (1, 'Regular', 50.00),
        (2, 'Covered', 80.00),
        (3, 'EVCharging', 120.00)
      ON CONFLICT (slot_type_id) DO UPDATE
      SET type_name = EXCLUDED.type_name, base_rate = EXCLUDED.base_rate;
    `);

    console.log('2. Configuring baseline 24 physical parking spaces...');
    for (let i = 1; i <= 24; i++) {
      let slotTypeId = 1;
      if (i > 12 && i <= 20) slotTypeId = 2;
      else if (i > 20) slotTypeId = 3;

      // Safe insert: preserve current operational status if slot is already occupied by an active ticket
      await client.query(`
        INSERT INTO parking_slots (slot_id, slot_type_id, status)
        VALUES ($1, $2, 'Available')
        ON CONFLICT (slot_id) DO UPDATE
        SET slot_type_id = EXCLUDED.slot_type_id,
            status = CASE 
              WHEN EXISTS (SELECT 1 FROM tickets WHERE slot_id = EXCLUDED.slot_id AND exit_time IS NULL) THEN 'Occupied'
              ELSE parking_slots.status
            END;
      `, [i, slotTypeId]);
    }

    console.log('3. Synchronizing all relational primary key sequences...');
    await client.query('SELECT * FROM fn_sync_all_sequences()');

    await client.query('COMMIT');
    console.log('--- Safe Configuration Setup Complete ---');
    console.log('• 3 Facility Slot Types ensured (Regular @ ₹50, Covered @ ₹80, EVCharging @ ₹120)');
    console.log('• 24 Baseline Physical Parking Spaces ensured (operational statuses preserved)');
    console.log('• Sequences fully synchronized with actual maximum table IDs');
    console.log('• Zero operational tickets, customer records, or sensor readings deleted');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during safe configuration seed:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Execute directly if run as main script
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  safeSeed()
    .then(() => pool.end())
    .catch(err => {
      console.error(err);
      pool.end();
      process.exit(1);
    });
}
