import { query } from '../db/index.js';
import { calculateFacilityPricingAdjustment } from '../services/pricingService.js';

/**
 * Calculates hourly occupancy metrics for a given time window [hourStart, hourEnd)
 * - Average occupancy %: (total occupied slot-hours / (totalSlots * 1.0 hr)) * 100
 * - Peak occupancy %: (maximum simultaneous active tickets / totalSlots) * 100
 * - Minimum occupancy %: (minimum simultaneous active tickets / totalSlots) * 100
 */
export function calculateIntervalMetrics(hourStart, hourEnd, totalSlots, ticketIntervals) {
  if (!totalSlots || totalSlots <= 0) {
    return {
      avgOccupancy: 0.0,
      peakOccupancy: 0.0,
      minOccupancy: 0.0,
      occupiedHours: 0.0,
      activeCount: 0,
      maxSimultaneous: 0,
      minSimultaneous: 0
    };
  }

  const hStart = typeof hourStart === 'number' ? hourStart : new Date(hourStart).getTime();
  const hEnd = typeof hourEnd === 'number' ? hourEnd : new Date(hourEnd).getTime();

  const overlapping = [];
  const eventPointsSet = new Set([hStart, hEnd]);

  for (const t of ticketIntervals) {
    const tEntry = typeof t.entry === 'number' ? t.entry : new Date(t.entry_time || t.entry).getTime();
    const rawExit = t.exit_time !== undefined ? t.exit_time : t.exit;
    const tExit = rawExit ? (typeof rawExit === 'number' ? rawExit : new Date(rawExit).getTime()) : Date.now();
    const clampedStart = Math.max(tEntry, hStart);
    const clampedEnd = Math.min(tExit, hEnd);
    if (clampedEnd > clampedStart) {
      overlapping.push({ start: clampedStart, end: clampedEnd, id: t.ticket_id });
      eventPointsSet.add(clampedStart);
      eventPointsSet.add(clampedEnd);
    }
  }

  if (overlapping.length === 0) {
    return {
      avgOccupancy: 0.0,
      peakOccupancy: 0.0,
      minOccupancy: 0.0,
      occupiedHours: 0.0,
      activeCount: 0,
      maxSimultaneous: 0,
      minSimultaneous: 0
    };
  }

  let totalOccupiedMs = 0;
  for (const seg of overlapping) {
    totalOccupiedMs += (seg.end - seg.start);
  }
  const occupiedSlotHours = totalOccupiedMs / 3600000.0;
  const avgOccupancy = Number(Math.min(100.0, Math.max(0.0, (occupiedSlotHours / (totalSlots * 1.0)) * 100.0)).toFixed(1));

  const points = Array.from(eventPointsSet).sort((a, b) => a - b);
  let maxSimultaneous = 0;
  let minSimultaneous = Infinity;

  for (let i = 0; i < points.length - 1; i++) {
    const segStart = points[i];
    const segEnd = points[i + 1];
    if (segEnd <= segStart) continue;
    let activeInSeg = 0;
    for (const t of overlapping) {
      if (t.start <= segStart && t.end >= segEnd) {
        activeInSeg++;
      }
    }
    if (activeInSeg > maxSimultaneous) maxSimultaneous = activeInSeg;
    if (activeInSeg < minSimultaneous) minSimultaneous = activeInSeg;
  }

  if (minSimultaneous === Infinity) minSimultaneous = 0;

  const peakOccupancy = Number(Math.min(100.0, Math.max(0.0, (maxSimultaneous / totalSlots) * 100.0)).toFixed(1));
  const minOccupancy = Number(Math.min(100.0, Math.max(0.0, (minSimultaneous / totalSlots) * 100.0)).toFixed(1));

  return {
    avgOccupancy,
    peakOccupancy,
    minOccupancy,
    occupiedHours: Number(occupiedSlotHours.toFixed(2)),
    activeCount: overlapping.length,
    maxSimultaneous,
    minSimultaneous
  };
}

/**
 * Calculates daily occupancy metrics for a given calendar day
 * - Complete capacity denominator: totalSlots * 24.0 hours
 * - Daily average occupancy %: (total occupied hours / (totalSlots * 24.0)) * 100
 */
export function calculateDailyIntervalMetrics(dayStart, totalSlots, ticketIntervals) {
  if (!totalSlots || totalSlots <= 0) {
    return { dailyAvg: 0.0, occupancyPercentage: 0.0, occupiedHours: 0.0, totalTickets: 0 };
  }
  const dStart = typeof dayStart === 'number' ? dayStart : new Date(dayStart).getTime();
  const dEnd = dStart + 24 * 3600 * 1000;

  let totalOccupiedMs = 0;
  let activeTicketsCount = 0;

  for (const t of ticketIntervals) {
    const tEntry = typeof t.entry === 'number' ? t.entry : new Date(t.entry_time || t.entry).getTime();
    const rawExit = t.exit_time !== undefined ? t.exit_time : t.exit;
    const tExit = rawExit ? (typeof rawExit === 'number' ? rawExit : new Date(rawExit).getTime()) : Date.now();
    const clampedStart = Math.max(tEntry, dStart);
    const clampedEnd = Math.min(tExit, dEnd);
    if (clampedEnd > clampedStart) {
      totalOccupiedMs += (clampedEnd - clampedStart);
      activeTicketsCount++;
    }
  }

  const occupiedHours = totalOccupiedMs / 3600000.0;
  const capacityHours = totalSlots * 24.0;
  const dailyAvg = Number(Math.min(100.0, Math.max(0.0, (occupiedHours / capacityHours) * 100.0)).toFixed(1));

  return {
    dailyAvg,
    occupancyPercentage: dailyAvg,
    occupiedHours: Number(occupiedHours.toFixed(1)),
    totalTickets: activeTicketsCount
  };
}

export async function getHourlyOccupancy(req, res, next) {
  try {
    const { slot_type_id, hours = 48, start_date, end_date } = req.query;
    const limitHours = Math.max(1, Math.min(720, parseInt(hours, 10) || 48));

    // Retrieve slot capacities per slot type
    let slotTypeCapFilter = '';
    const capParams = [];
    if (slot_type_id) {
      slotTypeCapFilter = 'WHERE st.slot_type_id = $1';
      capParams.push(parseInt(slot_type_id, 10));
    }

    const slotCapsRes = await query(`
      SELECT 
        st.slot_type_id,
        st.type_name,
        COUNT(ps.slot_id)::int AS total_slots
      FROM slot_types st
      LEFT JOIN parking_slots ps ON st.slot_type_id = ps.slot_type_id
      ${slotTypeCapFilter}
      GROUP BY st.slot_type_id, st.type_name
      ORDER BY st.slot_type_id ASC
    `, capParams);

    const slotCaps = slotCapsRes.rows;
    if (slotCaps.length === 0) {
      return res.json([]);
    }

    // Check if tickets exist in the system
    const hasTickets = await query(`SELECT COUNT(*) as count FROM tickets`);
    const ticketCount = parseInt(hasTickets.rows[0].count, 10);

    if (ticketCount > 0) {
      // Determine time window bounds
      let winStart;
      let winEnd;

      if (start_date && end_date) {
        winStart = new Date(start_date);
        winEnd = new Date(end_date);
      } else {
        const boundsRes = await query(`
          SELECT 
            MIN(entry_time) as min_entry,
            MAX(COALESCE(exit_time, NOW())) as max_exit
          FROM tickets;
        `);
        const maxExit = boundsRes.rows[0].max_exit ? new Date(boundsRes.rows[0].max_exit) : new Date();
        const minEntry = boundsRes.rows[0].min_entry ? new Date(boundsRes.rows[0].min_entry) : new Date();

        winEnd = end_date ? new Date(end_date) : maxExit;
        // Align to hour boundary
        winEnd.setMinutes(0, 0, 0);
        winEnd = new Date(winEnd.getTime() + 3600000);

        if (start_date) {
          winStart = new Date(start_date);
          winStart.setMinutes(0, 0, 0);
        } else {
          const desiredStart = new Date(winEnd.getTime() - limitHours * 3600000);
          winStart = desiredStart < minEntry ? new Date(Math.floor(minEntry.getTime() / 3600000) * 3600000) : desiredStart;
        }
      }

      // Query tickets overlapping the overall time window
      let ticketFilter = '';
      const tParams = [winStart.toISOString(), winEnd.toISOString()];
      if (slot_type_id) {
        ticketFilter = 'AND ps.slot_type_id = $3';
        tParams.push(parseInt(slot_type_id, 10));
      }

      const ticketsRes = await query(`
        SELECT 
          t.ticket_id,
          t.slot_id,
          ps.slot_type_id,
          t.entry_time,
          t.exit_time
        FROM tickets t
        JOIN parking_slots ps ON t.slot_id = ps.slot_id
        WHERE t.entry_time < $2::timestamptz
          AND (t.exit_time IS NULL OR t.exit_time > $1::timestamptz)
        ${ticketFilter}
      `, tParams);

      const allTickets = ticketsRes.rows;

      // Generate sequence of hourly buckets (chronologically ascending)
      const rows = [];
      let currentHourTime = winStart.getTime();
      const endTimeMs = winEnd.getTime();

      while (currentHourTime < endTimeMs) {
        const nextHourTime = currentHourTime + 3600000;
        const bucketIso = new Date(currentHourTime).toISOString();

        for (const sc of slotCaps) {
          const typeTickets = allTickets.filter(t => t.slot_type_id === sc.slot_type_id);
          const metrics = calculateIntervalMetrics(currentHourTime, nextHourTime, sc.total_slots, typeTickets);

          rows.push({
            time_bucket: bucketIso,
            hour_bucket: bucketIso,
            type_name: sc.type_name,
            avg_occupancy: metrics.avgOccupancy,
            avg_occupancy_pct: metrics.avgOccupancy,
            peak_occupancy: metrics.peakOccupancy,
            peak_occupancy_pct: metrics.peakOccupancy,
            min_occupancy: metrics.minOccupancy,
            min_occupancy_pct: metrics.minOccupancy,
            active_tickets_count: metrics.activeCount,
            total_slots: sc.total_slots
          });
        }

        currentHourTime = nextHourTime;
      }

      // If more than limitHours * slotCaps.length were generated, take the latest limitHours
      const totalSlotTypes = slotCaps.length;
      const maxRows = limitHours * totalSlotTypes;
      const finalRows = rows.length > maxRows ? rows.slice(rows.length - maxRows) : rows;

      return res.json(finalRows);
    }

    // Check if sensor readings hypertable has data as fallback
    const hasReadings = await query(`SELECT COUNT(*) as count FROM occupancy_readings`);
    const readingCount = parseInt(hasReadings.rows[0].count, 10);
    if (readingCount > 0) {
      const result = await query(`
        SELECT 
          bucket AS time_bucket,
          st.type_name,
          avg_occupancy_pct AS avg_occupancy,
          peak_occupancy_pct AS peak_occupancy,
          min_occupancy_pct AS min_occupancy,
          sample_count
        FROM hourly_occupancy_summary hos
        JOIN slot_types st ON hos.slot_type_id = st.slot_type_id
        ORDER BY bucket DESC
        LIMIT $1
      `, [limitHours]);
      return res.json(result.rows.reverse());
    }

    // Return empty array when no ticket or sensor records exist
    res.json([]);
  } catch (err) {
    next(err);
  }
}

export async function getDailyOccupancy(req, res, next) {
  try {
    const { slot_type_id, start_date, end_date } = req.query;
    const hasTickets = await query(`SELECT COUNT(*) as count FROM tickets`);
    const ticketCount = parseInt(hasTickets.rows[0].count, 10);

    if (ticketCount > 0) {
      let slotTypeFilter = '';
      const params = [];
      let paramIdx = 1;

      if (slot_type_id) {
        slotTypeFilter = `AND sc.slot_type_id = $${paramIdx++}`;
        params.push(parseInt(slot_type_id, 10));
      }

      let dateFilter = '';
      if (start_date) {
        dateFilter += ` AND td.day_bucket >= $${paramIdx++}::timestamptz`;
        params.push(start_date);
      }
      if (end_date) {
        dateFilter += ` AND td.day_bucket <= $${paramIdx++}::timestamptz`;
        params.push(end_date);
      }

      // Corrected daily occupancy calculation:
      // Computes genuine stay-duration sum across each calendar day, split properly
      // across midnight and all overlapping days, divided by complete facility capacity (total_slots * 24.0)
      const result = await query(`
        WITH slot_caps AS (
          SELECT 
            st.slot_type_id,
            st.type_name,
            COUNT(ps.slot_id)::int AS total_slots
          FROM slot_types st
          LEFT JOIN parking_slots ps ON st.slot_type_id = ps.slot_type_id
          GROUP BY st.slot_type_id, st.type_name
        ),
        ticket_days AS (
          SELECT 
            t.ticket_id,
            ps.slot_type_id,
            day_series.day_bucket,
            GREATEST(0.0, EXTRACT(EPOCH FROM (
              LEAST(COALESCE(t.exit_time, NOW()), day_series.day_bucket + interval '1 day') - 
              GREATEST(t.entry_time, day_series.day_bucket)
            )) / 3600.0) AS occupied_hours
          FROM tickets t
          JOIN parking_slots ps ON t.slot_id = ps.slot_id
          CROSS JOIN LATERAL generate_series(
            date_trunc('day', t.entry_time),
            date_trunc('day', COALESCE(t.exit_time, NOW())),
            '1 day'::interval
          ) AS day_series(day_bucket)
          WHERE LEAST(COALESCE(t.exit_time, NOW()), day_series.day_bucket + interval '1 day') > GREATEST(t.entry_time, day_series.day_bucket)
        )
        SELECT 
          td.day_bucket,
          td.day_bucket AS date,
          sc.type_name,
          -- Daily average occupancy % = (occupied_hours / (total_slots * 24.0)) * 100
          ROUND(
            LEAST(100.0, GREATEST(0.0, 
              (COALESCE(SUM(td.occupied_hours), 0.0) / NULLIF(sc.total_slots * 24.0, 0)) * 100.0
            )), 1
          ) AS daily_avg,
          ROUND(
            LEAST(100.0, GREATEST(0.0, 
              (COALESCE(SUM(td.occupied_hours), 0.0) / NULLIF(sc.total_slots * 24.0, 0)) * 100.0
            )), 1
          ) AS occupancy_percentage,
          COUNT(DISTINCT td.ticket_id)::int AS total_tickets,
          ROUND(COALESCE(SUM(td.occupied_hours), 0.0), 1) AS occupied_hours,
          sc.total_slots
        FROM ticket_days td
        JOIN slot_caps sc ON td.slot_type_id = sc.slot_type_id
        WHERE 1=1 ${slotTypeFilter} ${dateFilter}
        GROUP BY td.day_bucket, sc.type_name, sc.total_slots
        ORDER BY td.day_bucket ASC, sc.type_name ASC;
      `, params);

      return res.json(result.rows);
    }

    res.json([]);
  } catch (err) {
    next(err);
  }
}

export async function getPeakDemandByHour(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        EXTRACT(HOUR FROM t.entry_time)::int AS hour_of_day,
        st.type_name,
        COUNT(t.ticket_id) as total_entries
      FROM tickets t
      JOIN parking_slots ps ON t.slot_id = ps.slot_id
      JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
      GROUP BY hour_of_day, st.type_name
      ORDER BY hour_of_day ASC, st.type_name
    `);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getSlotTypeOccupancy(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        st.slot_type_id,
        st.type_name,
        st.base_rate,
        COUNT(ps.slot_id) as total_slots,
        COUNT(CASE WHEN ps.status = 'Occupied' THEN 1 END) as occupied_slots,
        COUNT(CASE WHEN ps.status = 'Available' THEN 1 END) as available_slots,
        COUNT(CASE WHEN ps.status = 'Reserved' THEN 1 END) as reserved_slots,
        CASE 
          WHEN COUNT(ps.slot_id) > 0 
          THEN ROUND((COUNT(CASE WHEN ps.status = 'Occupied' THEN 1 END)::numeric / COUNT(ps.slot_id)) * 100, 1)
          ELSE 0.0
        END as avg_occupancy
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

export async function getPricingPredictions(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        pp.pricing_id,
        pp.prediction_time,
        pp.slot_type_id,
        st.type_name as slot_type,
        pp.time_slot,
        pp.occupancy_pct,
        pp.suggested_rate,
        pp.model_version
      FROM pricing_predictions pp
      JOIN slot_types st ON pp.slot_type_id = st.slot_type_id
      ORDER BY pp.prediction_time DESC, pp.pricing_id DESC
      LIMIT 100
    `);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getOccupancyPredictions(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        op.prediction_id,
        op.prediction_time,
        op.slot_type_id,
        st.type_name as slot_type,
        op.time_slot,
        op.predicted_occupancy,
        op.model_version
      FROM occupancy_predictions op
      JOIN slot_types st ON op.slot_type_id = st.slot_type_id
      ORDER BY op.prediction_time DESC, op.prediction_id DESC
      LIMIT 100
    `);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getContinuousAggregateSummary(req, res, next) {
  try {
    const result = await query(`
      SELECT 
        bucket,
        system_code_number as entity_identifier,
        avg_occupancy_pct,
        peak_occupancy_pct,
        sample_count
      FROM birmingham_hourly_summary
      ORDER BY bucket DESC
      LIMIT 100
    `);

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

export async function getFacilityPricingRecommendations(req, res, next) {
  try {
    const slotStats = await query(`
      SELECT 
        st.slot_type_id,
        st.type_name,
        st.base_rate,
        COUNT(ps.slot_id) as total_slots,
        COUNT(CASE WHEN ps.status = 'Occupied' THEN 1 END) as occupied_slots
      FROM slot_types st
      LEFT JOIN parking_slots ps ON st.slot_type_id = ps.slot_type_id
      GROUP BY st.slot_type_id, st.type_name, st.base_rate
      ORDER BY st.slot_type_id ASC
    `);

    const recommendations = slotStats.rows.map(row => {
      const total = parseInt(row.total_slots, 10);
      const occupied = parseInt(row.occupied_slots, 10);
      const occupancyPct = total > 0 ? Number(((occupied / total) * 100).toFixed(1)) : 0.0;
      const baseRate = parseFloat(row.base_rate);

      const pricing = calculateFacilityPricingAdjustment(occupancyPct, row.type_name, baseRate);

      return {
        slot_type_id: row.slot_type_id,
        type_name: row.type_name,
        total_slots: total,
        occupied_slots: occupied,
        occupancy_pct: occupancyPct,
        ...pricing
      };
    });

    res.json({
      facility: 'ValetTrack Parking Facility',
      currency: 'INR',
      currencySymbol: '₹',
      policy: 'Dynamic Elasticity Model (4 Occupancy Demand Tiers: >80% Surge, 60-80% Standard, 30-<60% Incentive, <30% Discount)',
      recommendations
    });
  } catch (err) {
    next(err);
  }
}
