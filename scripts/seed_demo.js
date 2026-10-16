import { pool } from '../server/src/db/index.js';
import { safeSeed } from './seed.js';

export async function seedDemoData() {
  console.log('=== Seeding ValetTrack Operational Demo Dataset ===');
  const client = await pool.connect();

  try {
    // 1. Ensure baseline slot types and parking slots exist
    await safeSeed();

    await client.query('BEGIN');

    // 2. Demo Owners
    console.log('1. Seeding demo vehicle owners...');
    const owners = [
      { name: 'Rajesh Sharma', phone: '9876501234', email: 'rajesh.sharma@example.in' },
      { name: 'Priya Patel', phone: '9876505678', email: 'priya.patel@example.in' },
      { name: 'Amit Verma', phone: '9876509012', email: 'amit.verma@example.in' },
      { name: 'Sunita Rao', phone: '9876503456', email: 'sunita.rao@example.in' },
      { name: 'Vikram Malhotra', phone: '9876507890', email: 'vikram.malhotra@example.in' }
    ];

    const ownerIds = [];
    for (const o of owners) {
      const res = await client.query(`
        INSERT INTO owners (name, phone, email)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone
        RETURNING owner_id;
      `, [o.name, o.phone, o.email]);
      ownerIds.push(res.rows[0].owner_id);
    }

    // 3. Demo Vehicles
    console.log('2. Seeding demo vehicles...');
    const vehicles = [
      { vehicle_no: 'TN-09-AB-1234', type: 'Sedan', color: 'Silver Metallic', owner_id: ownerIds[0] },
      { vehicle_no: 'KA-03-CD-5678', type: 'SUV', color: 'Midnight Black', owner_id: ownerIds[1] },
      { vehicle_no: 'DL-01-EF-9012', type: 'EV', color: 'Pearl White', owner_id: ownerIds[2] },
      { vehicle_no: 'MH-02-GH-3456', type: 'Hatchback', color: 'Racing Red', owner_id: ownerIds[3] },
      { vehicle_no: 'HR-26-JK-7890', type: 'Electric Sedan', color: 'Electric Blue', owner_id: ownerIds[4] },
      { vehicle_no: 'TN-07-LM-2345', type: 'SUV', color: 'Titanium Grey', owner_id: ownerIds[0] }
    ];

    for (const v of vehicles) {
      await client.query(`
        INSERT INTO vehicles (vehicle_no, type, color, owner_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (vehicle_no) DO UPDATE 
        SET type = EXCLUDED.type, color = EXCLUDED.color, owner_id = EXCLUDED.owner_id;
      `, [v.vehicle_no, v.type, v.color, v.owner_id]);
    }

    // 4. Demo Valet Staff
    console.log('3. Seeding valet staff members...');
    const staffMembers = [
      { name: 'Ramesh Kumar', phone: '9811100001', shift_timing: 'Morning (06:00 - 14:00)' },
      { name: 'Suresh Singh', phone: '9811100002', shift_timing: 'Afternoon (14:00 - 22:00)' },
      { name: 'Karthik Subramanian', phone: '9811100003', shift_timing: 'Night (22:00 - 06:00)' },
      { name: 'Anand Murugan', phone: '9811100004', shift_timing: 'Morning (06:00 - 14:00)' }
    ];

    const staffIds = [];
    for (const s of staffMembers) {
      const res = await client.query(`
        INSERT INTO valet_staff (name, phone, shift_timing)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
        RETURNING staff_id;
      `, [s.name, s.phone, s.shift_timing]);

      if (res.rows.length > 0) {
        staffIds.push(res.rows[0].staff_id);
      } else {
        const existing = await client.query('SELECT staff_id FROM valet_staff WHERE phone = $1', [s.phone]);
        staffIds.push(existing.rows[0].staff_id);
      }
    }

    // 5. Historical Closed Tickets (for analytics and revenue)
    console.log('4. Seeding historical tickets for analytics and reporting...');
    const now = Date.now();
    const historicalTickets = [
      {
        vehicle_no: 'TN-09-AB-1234',
        slot_id: 1, // Regular (₹50/hr)
        staff_id: staffIds[0],
        entry_time: new Date(now - 72 * 3600 * 1000), // 3 days ago
        exit_time: new Date(now - 69 * 3600 * 1000),  // 3h stay
        amount_paid: 150.00
      },
      {
        vehicle_no: 'KA-03-CD-5678',
        slot_id: 13, // Covered (₹80/hr)
        staff_id: staffIds[1],
        entry_time: new Date(now - 48 * 3600 * 1000), // 2 days ago
        exit_time: new Date(now - 44 * 3600 * 1000),  // 4h stay
        amount_paid: 320.00
      },
      {
        vehicle_no: 'DL-01-EF-9012',
        slot_id: 21, // EVCharging (₹120/hr)
        staff_id: staffIds[0],
        entry_time: new Date(now - 28 * 3600 * 1000), // yesterday
        exit_time: new Date(now - 26 * 3600 * 1000),  // 2h stay
        amount_paid: 240.00
      },
      {
        vehicle_no: 'MH-02-GH-3456',
        slot_id: 2, // Regular (₹50/hr)
        staff_id: staffIds[2],
        entry_time: new Date(now - 14 * 3600 * 1000),
        exit_time: new Date(now - 12 * 3600 * 1000),  // 2h stay
        amount_paid: 100.00
      }
    ];

    for (const t of historicalTickets) {
      await client.query(`
        INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time, exit_time, amount_paid)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING;
      `, [t.vehicle_no, t.slot_id, t.staff_id, t.entry_time, t.exit_time, t.amount_paid]);
    }

    // 6. Active Tickets (currently parked vehicles)
    console.log('5. Seeding active parking tickets...');
    // Vehicle 1 on Slot 3 (Regular)
    const activeTicket1 = await client.query(`
      SELECT 1 FROM tickets WHERE vehicle_no = 'TN-07-LM-2345' AND exit_time IS NULL;
    `);
    if (activeTicket1.rows.length === 0) {
      await client.query(`
        INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time)
        VALUES ('TN-07-LM-2345', 3, $1, NOW() - INTERVAL '2 hours 15 minutes');
      `, [staffIds[0]]);
    }

    // Vehicle 2 on Slot 22 (EV Charging)
    const activeTicket2 = await client.query(`
      SELECT 1 FROM tickets WHERE vehicle_no = 'HR-26-JK-7890' AND exit_time IS NULL;
    `);
    if (activeTicket2.rows.length === 0) {
      await client.query(`
        INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time)
        VALUES ('HR-26-JK-7890', 22, $1, NOW() - INTERVAL '45 minutes');
      `, [staffIds[1]]);
    }

    // 7. Synchronize all sequences
    await client.query('SELECT * FROM fn_sync_all_sequences()');

    await client.query('COMMIT');
    console.log('=== Demo Dataset Seeding Completed Successfully ===');
    console.log(`• ${owners.length} Owners registered`);
    console.log(`• ${vehicles.length} Vehicles registered`);
    console.log(`• ${staffMembers.length} Valet Staff active`);
    console.log(`• ${historicalTickets.length} Historical closed tickets`);
    console.log('• 2 Active tickets on Slots #3 & #22 (Occupied)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding demo dataset:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed_demo.js')) {
  seedDemoData()
    .then(() => pool.end())
    .catch(err => {
      console.error(err);
      pool.end();
      process.exit(1);
    });
}
