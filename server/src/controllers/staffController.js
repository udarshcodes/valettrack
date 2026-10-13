import { query } from '../db/index.js';

export async function getStaff(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        s.staff_id,
        s.name,
        s.phone,
        s.shift_timing,
        s.created_at,
        COUNT(t.ticket_id) as total_tickets_handled,
        COUNT(CASE WHEN t.exit_time IS NULL THEN 1 END) as active_tickets
      FROM valet_staff s
      LEFT JOIN tickets t ON s.staff_id = t.staff_id
      GROUP BY s.staff_id, s.name, s.phone, s.shift_timing, s.created_at
      ORDER BY s.staff_id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function createStaff(req, res, next) {
  try {
    const { name, phone, shift_timing } = req.body;
    const result = await query(`
      INSERT INTO valet_staff (name, phone, shift_timing)
      VALUES ($1, $2, $3)
      RETURNING staff_id, name, phone, shift_timing, created_at
    `, [name, phone, shift_timing]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function updateStaff(req, res, next) {
  try {
    const { id } = req.params;
    const { name, phone, shift_timing } = req.body;

    const result = await query(`
      UPDATE valet_staff
      SET name = $1, phone = $2, shift_timing = $3
      WHERE staff_id = $4
      RETURNING staff_id, name, phone, shift_timing, created_at
    `, [name, phone, shift_timing, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Staff member ${id} not found` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function deleteStaff(req, res, next) {
  try {
    const { id } = req.params;

    const ticketCheck = await query(`
      SELECT COUNT(*) as count FROM tickets WHERE staff_id = $1
    `, [id]);

    if (parseInt(ticketCheck.rows[0].count, 10) > 0) {
      return res.status(400).json({
        error: 'CannotDelete',
        message: 'Cannot delete staff member with recorded tickets in history.'
      });
    }

    const result = await query(`
      DELETE FROM valet_staff
      WHERE staff_id = $1
      RETURNING staff_id, name
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Staff member ${id} not found` });
    }

    res.json({ message: 'Staff member deleted successfully', deleted: result.rows[0] });
  } catch (err) {
    next(err);
  }
}
