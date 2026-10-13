import { query, getClient } from '../db/index.js';

export async function getTickets(req, res, next) {
  try {
    const { status, limit = 50, offset = 0, search } = req.query;

    let whereClauses = [];
    let values = [];
    let paramIdx = 1;

    if (status === 'active') {
      whereClauses.push('t.exit_time IS NULL');
    } else if (status === 'completed') {
      whereClauses.push('t.exit_time IS NOT NULL');
    }

    if (search && search.trim() !== '') {
      whereClauses.push(`(t.vehicle_no ILIKE $${paramIdx} OR o.name ILIKE $${paramIdx})`);
      values.push(`%${search.trim()}%`);
      paramIdx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(*) as total
      FROM tickets t
      JOIN vehicles v ON t.vehicle_no = v.vehicle_no
      JOIN owners o ON v.owner_id = o.owner_id
      ${whereSql}
    `;
    const countRes = await query(countQuery, values);
    const totalCount = parseInt(countRes.rows[0].total, 10);

    const listQuery = `
      SELECT 
        t.ticket_id,
        t.vehicle_no,
        v.type as vehicle_type,
        v.color as vehicle_color,
        o.owner_id,
        o.name as owner_name,
        o.phone as owner_phone,
        t.slot_id,
        st.type_name as slot_type,
        st.base_rate,
        t.staff_id,
        s.name as staff_name,
        t.entry_time,
        t.exit_time,
        t.amount_paid,
        CASE WHEN t.exit_time IS NULL THEN 'Active' ELSE 'Completed' END as status,
        CASE 
          WHEN t.exit_time IS NOT NULL 
          THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (t.exit_time - t.entry_time)) / 3600.0))
          ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - t.entry_time)) / 3600.0))
        END as billable_hours
      FROM tickets t
      JOIN vehicles v ON t.vehicle_no = v.vehicle_no
      JOIN owners o ON v.owner_id = o.owner_id
      JOIN parking_slots ps ON t.slot_id = ps.slot_id
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      JOIN valet_staff s ON t.staff_id = s.staff_id
      ${whereSql}
      ORDER BY t.entry_time DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    values.push(parseInt(limit, 10), parseInt(offset, 10));
    const result = await query(listQuery, values);

    res.json({
      total: totalCount,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      tickets: result.rows
    });
  } catch (err) {
    next(err);
  }
}

export async function getTicketById(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT 
        t.ticket_id,
        t.vehicle_no,
        v.type as vehicle_type,
        v.color as vehicle_color,
        o.owner_id,
        o.name as owner_name,
        o.phone as owner_phone,
        t.slot_id,
        st.type_name as slot_type,
        st.base_rate,
        t.staff_id,
        s.name as staff_name,
        s.shift_timing as staff_shift,
        t.entry_time,
        t.exit_time,
        t.amount_paid,
        CASE WHEN t.exit_time IS NULL THEN 'Active' ELSE 'Completed' END as status,
        CASE 
          WHEN t.exit_time IS NOT NULL 
          THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (t.exit_time - t.entry_time)) / 3600.0))
          ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - t.entry_time)) / 3600.0))
        END as billable_hours
      FROM tickets t
      JOIN vehicles v ON t.vehicle_no = v.vehicle_no
      JOIN owners o ON v.owner_id = o.owner_id
      JOIN parking_slots ps ON t.slot_id = ps.slot_id
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      JOIN valet_staff s ON t.staff_id = s.staff_id
      WHERE t.ticket_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Ticket ${id} not found` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function openTicket(req, res, next) {
  const client = await getClient();
  try {
    const { vehicle_no, slot_id, staff_id } = req.body;
    const cleanVehicleNo = vehicle_no.toUpperCase().trim();

    await client.query('BEGIN');

    const vehicleRes = await client.query('SELECT vehicle_no FROM vehicles WHERE vehicle_no = $1', [cleanVehicleNo]);
    if (vehicleRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'InvalidVehicle', message: `Vehicle ${cleanVehicleNo} is not registered.` });
    }

    const activeVehCheck = await client.query('SELECT ticket_id, slot_id FROM tickets WHERE vehicle_no = $1 AND exit_time IS NULL', [cleanVehicleNo]);
    if (activeVehCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Conflict',
        code: 'VehicleAlreadyParked',
        message: `Vehicle ${cleanVehicleNo} already has an active ticket (#${activeVehCheck.rows[0].ticket_id}) in slot ${activeVehCheck.rows[0].slot_id}.`
      });
    }

    const staffRes = await client.query('SELECT staff_id FROM valet_staff WHERE staff_id = $1', [staff_id]);
    if (staffRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'InvalidStaff', message: `Valet staff #${staff_id} does not exist.` });
    }

    // Lock the parking slot row to prevent concurrent race condition allocation
    const slotRes = await client.query('SELECT slot_id, status FROM parking_slots WHERE slot_id = $1 FOR UPDATE', [slot_id]);
    if (slotRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'NotFound', message: `Parking slot #${slot_id} does not exist.` });
    }

    if (slotRes.rows[0].status !== 'Available') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Conflict',
        code: 'SlotNotAvailable',
        message: `Parking slot #${slot_id} is currently '${slotRes.rows[0].status}' and cannot be allocated.`
      });
    }

    const insertRes = await client.query(`
      INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time, exit_time, amount_paid)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, NULL, 0.00)
      RETURNING ticket_id, vehicle_no, slot_id, staff_id, entry_time, exit_time, amount_paid
    `, [cleanVehicleNo, slot_id, staff_id]);

    await client.query('COMMIT');

    const createdTicket = insertRes.rows[0];
    res.status(201).json({
      message: 'Ticket opened successfully',
      ticket: createdTicket
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      const constraint = err.constraint || '';
      if (constraint.includes('vehicle')) {
        return res.status(409).json({
          error: 'Conflict',
          code: 'VehicleAlreadyParked',
          message: `Vehicle already has an active ticket in progress.`
        });
      }
      if (constraint.includes('slot')) {
        return res.status(409).json({
          error: 'Conflict',
          code: 'SlotNotAvailable',
          message: `Parking slot is already occupied by an active ticket.`
        });
      }
      return res.status(409).json({
        error: 'Conflict',
        message: 'A conflicting ticket record already exists.',
        detail: err.detail
      });
    }
    next(err);
  } finally {
    client.release();
  }
}

export async function closeTicket(req, res, next) {
  const client = await getClient();
  try {
    const { id } = req.params;

    await client.query('BEGIN');

    const ticketRes = await client.query(`
      SELECT 
        t.ticket_id,
        t.vehicle_no,
        t.slot_id,
        t.staff_id,
        t.entry_time,
        t.exit_time,
        st.base_rate,
        st.type_name as slot_type
      FROM tickets t
      JOIN parking_slots ps ON t.slot_id = ps.slot_id
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      WHERE t.ticket_id = $1
      FOR UPDATE
    `, [id]);

    if (ticketRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'NotFound', message: `Ticket #${id} not found.` });
    }

    const ticket = ticketRes.rows[0];

    if (ticket.exit_time !== null) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'AlreadyClosed',
        message: `Ticket #${id} was already closed on ${ticket.exit_time}. Repeated closure is prohibited.`
      });
    }

    // Billing calculation: Whole billable hours rounded up (CEIL) * BaseRate, minimum 1 hour
    const exitTime = new Date();
    const entryTime = new Date(ticket.entry_time);
    const durationMs = exitTime.getTime() - entryTime.getTime();
    const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
    const rawHours = durationMs / (3600 * 1000);
    const billableHours = Math.max(1, Math.ceil(rawHours));
    const baseRate = parseFloat(ticket.base_rate);
    const amountPaid = Number((billableHours * baseRate).toFixed(2));

    const updateRes = await client.query(`
      UPDATE tickets
      SET exit_time = $1, amount_paid = $2
      WHERE ticket_id = $3
      RETURNING ticket_id, vehicle_no, slot_id, staff_id, entry_time, exit_time, amount_paid
    `, [exitTime, amountPaid, id]);

    await client.query('COMMIT');

    res.json({
      message: 'Ticket closed and billed successfully',
      billing: {
        durationMinutes,
        billableHours,
        baseRate,
        amountPaid,
        slotType: ticket.slot_type,
        slotReleased: ticket.slot_id
      },
      ticket: updateRes.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}
