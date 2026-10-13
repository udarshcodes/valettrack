import { pool } from '../server/src/db/index.js';

export async function devReset() {
  console.log('=== ValetTrack Development Database Reset ===');

  // Safeguard: Check environment
  const env = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  const dbName = (process.env.DB_NAME || '').trim().toLowerCase();
  const dbHost = (process.env.DB_HOST || '').trim().toLowerCase();

  if (env === 'production' || dbName.includes('prod') || dbHost.includes('prod')) {
    const errorMsg = 'CRITICAL SECURITY SAFEGUARD: Dev reset aborted. Running against production or production-like environment is strictly prohibited.';
    console.error(errorMsg);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('1. Safely truncating operational and transaction tables in development...');
    await client.query(`
      TRUNCATE TABLE tickets RESTART IDENTITY CASCADE;
      TRUNCATE TABLE vehicles CASCADE;
      TRUNCATE TABLE owners RESTART IDENTITY CASCADE;
      TRUNCATE TABLE valet_staff RESTART IDENTITY CASCADE;
      TRUNCATE TABLE occupancy_readings CASCADE;
      TRUNCATE TABLE occupancy_predictions CASCADE;
      TRUNCATE TABLE pricing_predictions CASCADE;
    `);

    console.log('2. Resetting facility slot types configuration...');
    await client.query(`
      INSERT INTO slot_types (slot_type_id, type_name, base_rate) VALUES
        (1, 'Regular', 50.00),
        (2, 'Covered', 80.00),
        (3, 'EVCharging', 120.00)
      ON CONFLICT (slot_type_id) DO UPDATE
      SET type_name = EXCLUDED.type_name, base_rate = EXCLUDED.base_rate;
    `);

    console.log('3. Resetting 24 physical parking spaces to Available...');
    for (let i = 1; i <= 24; i++) {
      let slotTypeId = 1;
      if (i > 12 && i <= 20) slotTypeId = 2;
      else if (i > 20) slotTypeId = 3;

      await client.query(`
        INSERT INTO parking_slots (slot_id, slot_type_id, status)
        VALUES ($1, $2, 'Available')
        ON CONFLICT (slot_id) DO UPDATE
        SET slot_type_id = EXCLUDED.slot_type_id, status = 'Available';
      `, [i, slotTypeId]);
    }

    console.log('4. Synchronizing all relational primary key sequences...');
    await client.query('SELECT * FROM fn_sync_all_sequences()');

    await client.query('COMMIT');
    console.log('=== Development Database Reset Completed Successfully ===');
    console.log('• Reference configuration: 3 slot types, 24 physical spaces (all Available)');
    console.log('• Operational tables cleared & sequences cleanly synchronized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during development database reset:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Execute directly if run as main script
if (process.argv[1] && process.argv[1].endsWith('dev_reset.js')) {
  devReset()
    .then(() => pool.end())
    .catch(err => {
      console.error(err.message);
      pool.end();
      process.exit(1);
    });
}
