import { query, getClient } from '../db/index.js';

function parseStrictInt(val) {
  if (typeof val === 'number') {
    return Number.isInteger(val) ? val : NaN;
  }
  if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) {
    return parseInt(val.trim(), 10);
  }
  return NaN;
}

function parseStrictFloat(val) {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : NaN;
  }
  if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())) {
    return parseFloat(val.trim());
  }
  return NaN;
}

export async function ingestTelemetry(req, res, next) {
  if (!req.body || (typeof req.body !== 'object')) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Telemetry payload must be a JSON object or an array of observation records.'
    });
  }

  const rawReadings = Array.isArray(req.body) ? req.body : [req.body];

  if (rawReadings.length === 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'Telemetry payload must contain at least one observation record.'
    });
  }

  const MAX_BATCH_SIZE = 500;
  if (rawReadings.length > MAX_BATCH_SIZE) {
    return res.status(400).json({
      error: 'ValidationError',
      message: `Batch size exceeds maximum limit of ${MAX_BATCH_SIZE} records per request.`
    });
  }

  const client = await getClient();
  try {
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

      if (!r || typeof r !== 'object' || Array.isArray(r)) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: Each telemetry record must be a valid JSON object.`
        });
      }

      // 1. Validate timestamp
      if (!r.reading_time || (typeof r.reading_time !== 'string' && !(r.reading_time instanceof Date))) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: reading_time timestamp is required and must be an ISO-8601 string.`
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
        const parsedTypeId = parseStrictInt(r.slot_type_id);
        if (isNaN(parsedTypeId) || parsedTypeId <= 0) {
          return res.status(400).json({
            error: 'ValidationError',
            message: `${recordIndex}: slot_type_id must be a positive integer.`
          });
        }
        matchedSlotType = slotTypeMap.get(parsedTypeId);
      } else if (r.slot_type || r.type_name) {
        const nameKey = String(r.slot_type || r.type_name).toLowerCase().trim();
        matchedSlotType = slotTypeMap.get(nameKey);
      }

      if (!matchedSlotType) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: Referenced slot category '${r.slot_type_id || r.slot_type || r.type_name}' does not exist.`
        });
      }

      // 3. Validate capacity & occupied spaces strictly
      const totalSlots = parseStrictInt(r.total_slots);
      const occupiedSlots = parseStrictInt(r.occupied_slots);

      if (isNaN(totalSlots) || totalSlots <= 0) {
        return res.status(400).json({
          error: 'ValidationError',
          message: `${recordIndex}: total_slots must be a strictly positive integer > 0.`
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
        const providedPct = parseStrictFloat(r.occupancy_pct);
        if (isNaN(providedPct) || providedPct < 0.0 || providedPct > 100.0) {
          return res.status(400).json({
            error: 'ValidationError',
            message: `${recordIndex}: occupancy_pct must be a valid numeric percentage between 0.00 and 100.00.`
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

      let sourceTag = 'facility_sensor_feed';
      if (r.source !== undefined && r.source !== null) {
        const rawSource = String(r.source).trim();
        if (rawSource.length === 0 || rawSource.length > 50 || !/^[a-zA-Z0-9_\-\.\:\/ ]+$/.test(rawSource)) {
          return res.status(400).json({
            error: 'ValidationError',
            message: `${recordIndex}: source must be an alphanumeric string up to 50 characters.`
          });
        }
        sourceTag = rawSource;
      }

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

    // 5. Transactional insertion with safe database-level duplicate resolution
    await client.query('BEGIN');

    let insertedCount = 0;
    let updatedCount = 0;
    const insertedRows = [];

    for (const row of validatedReadings) {
      const insertRes = await client.query(`
        INSERT INTO occupancy_readings (
          reading_time, slot_type_id, total_slots, occupied_slots, occupancy_pct, source
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (reading_time, slot_type_id) 
        DO UPDATE SET
          total_slots = EXCLUDED.total_slots,
          occupied_slots = EXCLUDED.occupied_slots,
          occupancy_pct = EXCLUDED.occupancy_pct,
          source = EXCLUDED.source
        RETURNING (xmax = 0) AS is_inserted, reading_id, reading_time, slot_type_id, total_slots, occupied_slots, occupancy_pct, source;
      `, [row.reading_time, row.slot_type_id, row.total_slots, row.occupied_slots, row.occupancy_pct, row.source]);

      const isInserted = insertRes.rows[0].is_inserted;
      if (isInserted) {
        insertedCount++;
      } else {
        updatedCount++;
      }

      insertedRows.push({
        ...insertRes.rows[0],
        slot_type_name: row.slot_type_name
      });
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: `Successfully processed ${validatedReadings.length} facility occupancy observation(s).`,
      count_processed: validatedReadings.length,
      count_inserted: insertedCount,
      count_updated: updatedCount,
      duplicates_ignored: updatedCount,
      readings: insertedRows
    });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
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

    // Fetch chronological hourly buckets for gap detection and consecutive sequence analysis
    const hourlyBucketsRes = await query(`
      SELECT 
        date_trunc('hour', reading_time) as bucket,
        ROUND(AVG(occupancy_pct), 2) as avg_occ,
        COUNT(*) as readings_in_hour
      FROM occupancy_readings
      WHERE reading_time >= NOW() - INTERVAL '48 hours'
      GROUP BY date_trunc('hour', reading_time)
      ORDER BY bucket ASC;
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
    const buckets = hourlyBucketsRes.rows;
    const count48h = parseInt(stats.readings_last_48h, 10);

    let consecutiveHours = 0;
    let missingHours = [];
    let isStale = false;
    let latestBucketTime = null;

    if (buckets.length > 0) {
      const lastRow = buckets[buckets.length - 1];
      latestBucketTime = new Date(lastRow.bucket);
      const nowMs = Date.now();
      const hoursSinceLatest = (nowMs - latestBucketTime.getTime()) / (3600 * 1000);
      
      // Telemetry is considered stale if the most recent reading is older than 3 hours
      if (hoursSinceLatest > 3.0) {
        isStale = true;
      }

      // Check consecutive hours backwards from the latest hourly bucket
      const bucketTimestampSet = new Set(buckets.map(b => new Date(b.bucket).getTime()));
      for (let k = 0; k < 24; k++) {
        const expectedMs = latestBucketTime.getTime() - (k * 3600 * 1000);
        if (bucketTimestampSet.has(expectedMs)) {
          consecutiveHours++;
        } else {
          missingHours.push(new Date(expectedMs).toISOString());
        }
      }
    }

    const isReadyForOperational = !isStale && consecutiveHours >= 24;

    let readinessMessage = '';
    if (buckets.length === 0) {
      readinessMessage = 'No facility sensor observations recorded in the last 48 hours. Telemetry stream required for operational forecasting.';
    } else if (isStale) {
      readinessMessage = `Operational forecasting unavailable: latest facility telemetry (${latestBucketTime.toISOString()}) is stale (> 3 hours old). Fresh live observations required.`;
    } else if (consecutiveHours < 24) {
      readinessMessage = `Insufficient consecutive hourly telemetry (${consecutiveHours}/24 hours found). Operational forecasting requires 24 continuous hourly observations to compute exact lag_24h features without synthetic imputation.`;
    } else {
      readinessMessage = `Operational forecasting ready: ${consecutiveHours} consecutive hourly observations available up to ${latestBucketTime.toISOString()}.`;
    }

    let streamHealth = 'UNAVAILABLE';
    if (buckets.length === 0) {
      streamHealth = 'UNAVAILABLE';
    } else if (isStale) {
      streamHealth = 'STALE';
    } else if (consecutiveHours < 24) {
      streamHealth = 'DEGRADED';
    } else {
      streamHealth = 'HEALTHY';
    }

    res.json({
      total_readings: parseInt(stats.total_readings, 10),
      readings_last_48h: count48h,
      readings_last_24h: parseInt(stats.readings_last_24h, 10),
      earliest_reading: stats.earliest_reading,
      latest_reading: stats.latest_reading,
      latest_hourly_bucket: latestBucketTime ? latestBucketTime.toISOString() : null,
      is_stale: isStale,
      consecutive_hourly_readings: consecutiveHours,
      required_consecutive_hours: 24,
      missing_hourly_buckets: missingHours,
      monitored_slot_types: parseInt(stats.monitored_slot_types, 10),
      operational_forecasting_ready: isReadyForOperational,
      stream_health: streamHealth,
      status: isReadyForOperational ? 'OPERATIONAL_READY' : 'INSUFFICIENT_TELEMETRY',
      operational_readiness_message: readinessMessage,
      slot_types: slotBreakdownRes.rows
    });
  } catch (err) {
    next(err);
  }
}

export async function getRecentTelemetry(req, res, next) {
  try {
    const rawLimit = req.query.limit !== undefined ? req.query.limit : 50;
    const rawOffset = req.query.offset !== undefined ? req.query.offset : 0;
    const rawSlotTypeId = req.query.slot_type_id;

    const limit = parseStrictInt(rawLimit);
    if (isNaN(limit) || limit < 1 || limit > 200) {
      return res.status(400).json({
        error: 'ValidationError',
        message: "Query parameter 'limit' must be an integer between 1 and 200."
      });
    }

    const offset = parseStrictInt(rawOffset);
    if (isNaN(offset) || offset < 0 || offset > 10000) {
      return res.status(400).json({
        error: 'ValidationError',
        message: "Query parameter 'offset' must be a non-negative integer <= 10000."
      });
    }

    let whereClause = '';
    const params = [limit, offset];

    if (rawSlotTypeId !== undefined) {
      const slotTypeId = parseStrictInt(rawSlotTypeId);
      if (isNaN(slotTypeId) || slotTypeId <= 0) {
        return res.status(400).json({
          error: 'ValidationError',
          message: "Query parameter 'slot_type_id' must be a positive integer."
        });
      }
      whereClause = 'WHERE o.slot_type_id = $3';
      params.push(slotTypeId);
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
