import { query } from '../db/index.js';

export async function getOwners(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        o.owner_id,
        o.name,
        o.phone,
        o.email,
        o.created_at,
        COUNT(v.vehicle_no) as vehicle_count
      FROM owners o
      LEFT JOIN vehicles v ON o.owner_id = v.owner_id
      GROUP BY o.owner_id, o.name, o.phone, o.email, o.created_at
      ORDER BY o.owner_id ASC
    `);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getOwnerById(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT owner_id, name, phone, email, created_at
      FROM owners
      WHERE owner_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Owner with ID ${id} not found` });
    }

    const vehiclesResult = await query(`
      SELECT vehicle_no, type, color, created_at
      FROM vehicles
      WHERE owner_id = $1
    `, [id]);

    res.json({
      ...result.rows[0],
      vehicles: vehiclesResult.rows
    });
  } catch (err) {
    next(err);
  }
}

export async function createOwner(req, res, next) {
  try {
    const { name, phone, email } = req.body;
    const result = await query(`
      INSERT INTO owners (name, phone, email)
      VALUES ($1, $2, $3)
      RETURNING owner_id, name, phone, email, created_at
    `, [name, phone, email]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function updateOwner(req, res, next) {
  try {
    const { id } = req.params;
    const { name, phone, email } = req.body;

    const result = await query(`
      UPDATE owners
      SET name = $1, phone = $2, email = $3
      WHERE owner_id = $4
      RETURNING owner_id, name, phone, email, created_at
    `, [name, phone, email, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Owner with ID ${id} not found` });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

export async function deleteOwner(req, res, next) {
  try {
    const { id } = req.params;

    const checkVehicles = await query(`
      SELECT COUNT(*) as count FROM vehicles WHERE owner_id = $1
    `, [id]);

    if (parseInt(checkVehicles.rows[0].count, 10) > 0) {
      return res.status(400).json({
        error: 'CannotDelete',
        message: 'Cannot delete owner with registered vehicles. Please reassign or delete the vehicles first.'
      });
    }

    const result = await query(`
      DELETE FROM owners
      WHERE owner_id = $1
      RETURNING owner_id, name
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'NotFound', message: `Owner with ID ${id} not found` });
    }

    res.json({ message: 'Owner deleted successfully', deleted: result.rows[0] });
  } catch (err) {
    next(err);
  }
}
