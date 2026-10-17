import { query, getClient } from '../db/index.js';

export async function ingestTelemetry(req, res, next) {
  const client = await getClient();
  try {
    const rawReadings = Array.isArray(req.body) ? req.body : [req.body];

    if (rawReadings.length === 0) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Telemetry payload must contain at least one observation record.'
      });
    }

    // Retrieve active slot types for validation and name resolution
    const slotTypesRes = await client.query('SELECT slot_type_id, type_name FROM slot_types ORDER BY slot_type_id ASC;');
    const slotTypes = slotTypesRes.rows;
    const slotTypeMap = new Map();
    for (const st of slotTypes) {
      slotTypeMap.set(st.slot_type_id, st);
      slotTypeMap.set(st.type_name.toLowerCase(), st);
    }

    const now = Date.now();
    const maxFutureMs = 5 * 60 * 1000; // max 5 minutes in future (clock skew allowance)
    const maxAgeMs = 7 * 24 * 3600 * 1000; // max 7 days old

    const validatedReadings = [];

    for (let i = 0; i < rawReadings.length; i++) {
      const r = rawReadings[i];
      const recordIndex = `Record [${i}]`;

      // 1. Validate timestamp
      if (!r.reading_time) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: reading_time timestamp is required.`
        });
      }

      const readingDate = new Date(r.reading_time);
      const timeMs = readingDate.getTime();
      if (isNaN(timeMs)) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: reading_time '${r.reading_time}' is not a valid ISO-8601 timestamp.`
        });
      }

      if (timeMs > now + maxFutureMs) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: observation timestamp is in the future (${readingDate.toISOString()}).`
        });
      }

      if (now - timeMs > maxAgeMs) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: observation timestamp is excessively stale (older than 7 days: ${readingDate.toISOString()}).`
        });
      }

      // 2. Validate slot category
      let matchedSlotType = null;
      if (r.slot_type_id !== undefined && r.slot_type_id !== null) {
        matchedSlotType = slotTypeMap.get(Number(r.slot_type_id));
      } else if (r.slot_type || r.type_name) {
        const nameKey = (r.slot_type || r.type_name).toLowerCase().trim();
        matchedSlotType = slotTypeMap.get(nameKey);
      }

      if (!matchedSlotType) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: Referenced slot category '${r.slot_type_id || r.slot_type || r.type_name}' does not exist.`
        });
      }

      // 3. Validate capacity & occupied spaces
      const totalSlots = parseInt(r.total_slots, 10);
      const occupiedSlots = parseInt(r.occupied_slots, 10);

      if (isNaN(totalSlots) || totalSlots <= 0) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: total_slots must be a positive integer > 0.`
        });
      }

      if (isNaN(occupiedSlots) || occupiedSlots < 0) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: occupied_slots must be a non-negative integer >= 0.`
        });
      }

      if (occupiedSlots > totalSlots) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: occupied_slots (${occupiedSlots}) cannot exceed total_slots capacity (${totalSlots}).`
        });
      }

      // 4. Validate occupancy percentage and mathematical consistency
      const expectedPct = (occupiedSlots / totalSlots) * 100.0;
      let finalPct;

      if (r.occupancy_pct !== undefined && r.occupancy_pct !== null) {
        const providedPct = parseFloat(r.occupancy_pct);
        if (isNaN(providedPct) || providedPct < 0.0 || providedPct > 100.0) {
          return res.status(400).json({
            error: 'ValidationError',
            message: `${recordIndex}: occupancy_pct must be between 0.00 and 100.00.`
          });
        }
        if (Math.abs(providedPct - expectedPct) > 1.0) {
          return res.status(400).json({
            error: 'ValidationError',
            message: `${recordIndex}: occupancy_pct (${providedPct}%) is mathematically inconsistent with count ratio (${occupiedSlots}/${totalSlots} = ${expectedPct.toFixed(2)}%).`
          });
        }
        finalPct = Number(providedPct.toFixed(2));
      } else {
        finalPct = Number(expectedPct.toFixed(2));
      }

      const sourceTag = (r.source || 'facility_sensor_feed').trim().slice(0, 50);

      validatedReadings.push({
        reading_time: readingDate,
        slot_type_id: matchedSlotType.slot_type_id,
        slot_type_name: matchedSlotType.type_name,
        total_slots: totalSlots,
        occupied_slots: occupiedSlots,
        occupancy_pct: finalPct,
        source: sourceTag
      });
    }

    // 5. Transactional insertion with duplicate prevention
    await client.query('BEGIN');

    let insertedCount = 0;
    const insertedRows = [];

    for (const row of validatedReadings) {
      // Check for identical observation already recorded
      const dupCheck = await client.query(`
        SELECT reading_id FROM occupancy_readings
        WHERE reading_time = $1 AND slot_type_id = $2
        LIMIT 1;
      `, [row.reading_time, row.slot_type_id]);

      if (dupCheck.rows.length > 0) {
        // Skip duplicate observation
        continue;
      }

      const insertRes = await client.query(`
        INSERT INTO occupancy_readings (
          reading_time, slot_type_id, total_slots, occupied_slots, occupancy_pct, source
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING reading_id, reading_time, slot_type_id, total_slots, occupied_slots, occupancy_pct, source;
      `, [row.reading_time, row.slot_type_id, row.total_slots, row.occupied_slots, row.occupancy_pct, row.source]);

      insertedRows.push({
        ...insertRes.rows[0],
        slot_type_name: row.slot_type_name
      });
      insertedCount++;
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: `Successfully ingested ${insertedCount} facility occupancy observation(s).`,
      count_processed: validatedReadings.length,
      count_inserted: insertedCount,
      duplicates_ignored: validatedReadings.length - insertedCount,
      readings: insertedRows
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

export async function getTelemetryStatus(req, res, next) {
  try {
    const statsRes = await query(`
      SELECT 
        COUNT(*) as total_readings,
        COUNT(CASE WHEN reading_time >= NOW() - INTERVAL '48 hours' THEN 1 END) as readings_last_48h,
        COUNT(CASE WHEN reading_time >= NOW() - INTERVAL '24 hours' THEN 1 END) as readings_last_24h,
        MIN(reading_time) as earliest_reading,
        MAX(reading_time) as latest_reading,
        COUNT(DISTINCT slot_type_id) as monitored_slot_types
      FROM occupancy_readings;
    `);

    const slotBreakdownRes = await query(`
      SELECT 
        st.slot_type_id,
        st.type_name,
        COUNT(o.reading_id) as total_readings,
        COUNT(CASE WHEN o.reading_time >= NOW() - INTERVAL '48 hours' THEN 1 END) as readings_last_48h,
        ROUND(AVG(CASE WHEN o.reading_time >= NOW() - INTERVAL '24 hours' THEN o.occupancy_pct END), 2) as avg_24h_occupancy,
        MAX(o.reading_time) as latest_reading
      FROM slot_types st
      LEFT JOIN occupancy_readings o ON st.slot_type_id = o.slot_type_id
      GROUP BY st.slot_type_id, st.type_name
      ORDER BY st.slot_type_id ASC;
    `);

    const stats = statsRes.rows[0];
    const count48h = parseInt(stats.readings_last_48h, 10);
    const isReadyForOperational = count48h >= 12;

    res.json({
      total_readings: parseInt(stats.total_readings, 10),
      readings_last_48h: count48h,
      readings_last_24h: parseInt(stats.readings_last_24h, 10),
      earliest_reading: stats.earliest_reading,
      latest_reading: stats.latest_reading,
      monitored_slot_types: parseInt(stats.monitored_slot_types, 10),
      operational_forecasting_ready: isReadyForOperational,
      status: isReadyForOperational ? 'OPERATIONAL_READY' : 'INSUFFICIENT_TELEMETRY',
      operational_readiness_message: isReadyForOperational
        ? `Facility has ${count48h} genuine telemetry reading(s) in the last 48 hours (>= 12 required). Operational forecasting is ready.`
        : `Facility has ${count48h} reading(s) in the last 48 hours. Minimum 12 hours of sequential telemetry required for operational forecasting without synthetic fabrication.`,
      slot_types: slotBreakdownRes.rows
    });
  } catch (err) {
    next(err);
  }
}

export async function getRecentTelemetry(req, res, next) {
  try {
    const { limit = 50, offset = 0, slot_type_id } = req.query;

    let whereClause = '';
    const params = [parseInt(limit, 10), parseInt(offset, 10)];

    if (slot_type_id) {
      whereClause = 'WHERE o.slot_type_id = $3';
      params.push(parseInt(slot_type_id, 10));
    }

    const result = await query(`
      SELECT 
        o.reading_id,
        o.reading_time,
        o.slot_type_id,
        st.type_name as slot_type,
        o.total_slots,
        o.occupied_slots,
        o.occupancy_pct,
        o.source
      FROM occupancy_readings o
      JOIN slot_types st ON o.slot_type_id = st.slot_type_id
      ${whereClause}
      ORDER BY o.reading_time DESC, o.reading_id DESC
      LIMIT $1 OFFSET $2;
    `, params);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}
