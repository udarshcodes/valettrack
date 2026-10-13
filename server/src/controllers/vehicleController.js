import { query } from '../db/index.js';

export async function getVehicles(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        v.vehicle_no,
        v.type,
        v.color,
        v.owner_id,
        o.name as owner_name,
        o.phone as owner_phone,
        o.email as owner_email,
        v.created_at,
        COUNT(t.ticket_id) as total_tickets,
        COUNT(CASE WHEN t.exit_time IS NULL THEN 1 END) as active_tickets
      FROM vehicles v
      JOIN owners o ON v.owner_id = o.owner_id
      LEFT JOIN tickets t ON v.vehicle_no = t.vehicle_no
      GROUP BY v.vehicle_no, v.type, v.color, v.owner_id, o.name, o.phone, o.email, v.created_at
      ORDER BY v.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getVehicleByNo(req, res, next) {
  try {
    const { vehicle_no } = req.params;
    const result = await query(`
      SELECT 
        v.vehicle_no,
        v.type,
        v.color,
        v.owner_id,
        o.name as owner_name,
        o.phone as owner_phone,
        o.email as owner_email,
        v.created_at
      FROM vehicles v
      JOIN owners o ON v.owner_id = o.owner_id
      WHERE v.vehicle_no = $1
    `, [vehicle_no]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Vehicle ${vehicle_no} not found` });
    }

    const tickets = await query(`
      SELECT 
        t.ticket_id,
        t.slot_id,
        st.type_name as slot_type,
        s.name as staff_name,
        t.entry_time,
        t.exit_time,
        t.amount_paid
      FROM tickets t
      JOIN parking_slots ps ON t.slot_id = ps.slot_id
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      JOIN valet_staff s ON t.staff_id = s.staff_id
      WHERE t.vehicle_no = $1
      ORDER BY t.entry_time DESC
    `, [vehicle_no]);

    res.json({
      ...result.rows[0],
      tickets: tickets.rows
    });
  } catch (err) {
    next(err);
  }
}

export async function createVehicle(req, res, next) {
  try {
    const { vehicle_no, type, color, owner_id } = req.body;

    const ownerCheck = await query('SELECT owner_id FROM owners WHERE owner_id = $1', [owner_id]);
    if (ownerCheck.rows.length === 0) {
      return res.status(400).json({ error: 'InvalidOwner', message: `Owner with ID ${owner_id} does not exist.` });
    }

    const result = await query(`
      INSERT INTO vehicles (vehicle_no, type, color, owner_id)
      VALUES ($1, $2, $3, $4)
      RETURNING vehicle_no, type, color, owner_id, created_at
    `, [vehicle_no.toUpperCase().trim(), type, color, owner_id]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function updateVehicle(req, res, next) {
  try {
    const { vehicle_no } = req.params;
    const { type, color, owner_id } = req.body;

    const ownerCheck = await query('SELECT owner_id FROM owners WHERE owner_id = $1', [owner_id]);
    if (ownerCheck.rows.length === 0) {
      return res.status(400).json({ error: 'InvalidOwner', message: `Owner with ID ${owner_id} does not exist.` });
    }

    const result = await query(`
      UPDATE vehicles
      SET type = $1, color = $2, owner_id = $3
      WHERE vehicle_no = $4
      RETURNING vehicle_no, type, color, owner_id, created_at
    `, [type, color, owner_id, vehicle_no]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Vehicle ${vehicle_no} not found` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function deleteVehicle(req, res, next) {
  try {
    const { vehicle_no } = req.params;

    const checkTickets = await query(`
      SELECT COUNT(*) as count FROM tickets WHERE vehicle_no = $1
    `, [vehicle_no]);

    if (parseInt(checkTickets.rows[0].count, 10) > 0) {
      return res.status(400).json({
        error: 'CannotDelete',
        message: 'Cannot delete vehicle with parking tickets on record.'
      });
    }

    const result = await query(`
      DELETE FROM vehicles
      WHERE vehicle_no = $1
      RETURNING vehicle_no
    `, [vehicle_no]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Vehicle ${vehicle_no} not found` });
    }

    res.json({ message: 'Vehicle deleted successfully', deleted: result.rows[0] });
  } catch (err) {
    next(err);
  }
}
