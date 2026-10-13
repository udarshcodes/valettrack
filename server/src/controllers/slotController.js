import { query, getClient } from '../db/index.js';
import { recommendParkingSlot } from '../services/allocationService.js';

export async function getSlots(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        ps.slot_id,
        ps.slot_type_id,
        st.type_name,
        st.base_rate,
        ps.status,
        t.ticket_id as active_ticket_id,
        t.vehicle_no as active_vehicle_no,
        v.type as active_vehicle_type,
        o.name as active_owner_name,
        s.name as active_staff_name,
        t.entry_time as active_entry_time
      FROM parking_slots ps
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      LEFT JOIN tickets t ON ps.slot_id = t.slot_id AND t.exit_time IS NULL
      LEFT JOIN vehicles v ON t.vehicle_no = v.vehicle_no
      LEFT JOIN owners o ON v.owner_id = o.owner_id
      LEFT JOIN valet_staff s ON t.staff_id = s.staff_id
      ORDER BY ps.slot_id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getSlotById(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT 
        ps.slot_id,
        ps.slot_type_id,
        st.type_name,
        st.base_rate,
        ps.status
      FROM parking_slots ps
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      WHERE ps.slot_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Slot ${id} not found` });
    }

    const tickets = await query(`
      SELECT 
        t.ticket_id,
        t.vehicle_no,
        v.type as vehicle_type,
        s.name as staff_name,
        t.entry_time,
        t.exit_time,
        t.amount_paid
      FROM tickets t
      JOIN vehicles v ON t.vehicle_no = v.vehicle_no
      JOIN valet_staff s ON t.staff_id = s.staff_id
      WHERE t.slot_id = $1
      ORDER BY t.entry_time DESC
      LIMIT 15
    `, [id]);

    res.json({
      ...result.rows[0],
      history: tickets.rows
    });
  } catch (err) {
    next(err);
  }
}

export async function updateSlotStatus(req, res, next) {
  const client = await getClient();
  try {
    const { id } = req.params;
    const { status } = req.body;

    await client.query('BEGIN');

    const slotCheck = await client.query(`
      SELECT slot_id, status FROM parking_slots WHERE slot_id = $1 FOR UPDATE
    `, [id]);

    if (slotCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'NotFound', message: `Slot ${id} not found` });
    }

    const activeTicket = await client.query(`
      SELECT ticket_id FROM tickets WHERE slot_id = $1 AND exit_time IS NULL
    `, [id]);

    if (activeTicket.rows.length > 0 && status !== 'Occupied') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'SlotInUse',
        message: `Cannot change status to '${status}' while ticket #${activeTicket.rows[0].ticket_id} is active in this slot.`
      });
    }

    const result = await client.query(`
      UPDATE parking_slots
      SET status = $1
      WHERE slot_id = $2
      RETURNING slot_id, slot_type_id, status
    `, [status, id]);

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

export async function getSlotTypes(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        st.slot_type_id,
        st.type_name,
        st.base_rate,
        COUNT(ps.slot_id) as total_slots
      FROM slot_types st
      LEFT JOIN parking_slots ps ON st.slot_type_id = ps.slot_type_id
      GROUP BY st.slot_type_id, st.type_name, st.base_rate
      ORDER BY st.slot_type_id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function updateSlotTypeRate(req, res, next) {
  try {
    const { id } = req.params;
    const { base_rate } = req.body;

    const result = await query(`
      UPDATE slot_types
      SET base_rate = $1
      WHERE slot_type_id = $2
      RETURNING slot_type_id, type_name, base_rate
    `, [base_rate, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Slot type ${id} not found` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function createSlot(req, res, next) {
  try {
    const { slot_type_id, status = 'Available' } = req.body;
    if (!slot_type_id) {
      return res.status(400).json({ error: 'ValidationError', message: 'slot_type_id is required' });
    }
    const result = await query(`
      INSERT INTO parking_slots (slot_type_id, status)
      VALUES ($1, $2)
      RETURNING slot_id, slot_type_id, status
    `, [parseInt(slot_type_id, 10), status]);

    res.status(201).json({ slot: result.rows[0], ...result.rows[0] });
  } catch (err) {
    next(err);
  }
}

export async function recommendSlot(req, res, next) {
  try {
    const params = req.method === 'POST' ? req.body : req.query;
    const recommendation = await recommendParkingSlot(params);
    res.json(recommendation);
  } catch (err) {
    next(err);
  }
}

