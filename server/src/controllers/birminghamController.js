import { query } from '../db/index.js';

export async function getBirminghamSummary(req, res, next) {
  try {
    const summary = await query(`
      SELECT 
        COUNT(*) as total_readings,
        COUNT(DISTINCT system_code_number) as total_carparks,
        ROUND(AVG(occupancy_pct), 1) as overall_avg_occupancy,
        MAX(capacity) as max_capacity,
        MIN(reading_time) as start_date,
        MAX(reading_time) as end_date
      FROM birmingham_readings
    `);

    const topCarParks = await query(`
      SELECT 
        system_code_number,
        ROUND(AVG(avg_occupancy_pct), 1) as avg_occupancy,
        MAX(peak_occupancy_pct) as peak_occupancy,
        MAX(capacity) as capacity,
        COUNT(*) as hours_monitored
      FROM birmingham_hourly_summary
      GROUP BY system_code_number
      ORDER BY avg_occupancy DESC
    `);

    const aggregateCount = await query(`
      SELECT COUNT(*) as count FROM birmingham_hourly_summary
    `);

    res.json({
      summary: {
        ...summary.rows[0],
        continuous_aggregate_count: parseInt(aggregateCount.rows[0].count, 10)
      },
      carParks: topCarParks.rows
    });
  } catch (err) {
    next(err);
  }
}

export async function getBirminghamHourly(req, res, next) {
  try {
    const { code, limit = 72, start_date, end_date } = req.query;

    const conditions = [];
    const params = [parseInt(limit, 10)];
    let paramIdx = 2;

    if (code) {
      conditions.push(`system_code_number = $${paramIdx++}`);
      params.push(code);
    }
    if (start_date) {
      conditions.push(`bucket >= $${paramIdx++}`);
      params.push(start_date);
    }
    if (end_date) {
      conditions.push(`bucket <= $${paramIdx++}`);
      params.push(end_date);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(`
      SELECT 
        bucket,
        system_code_number,
        avg_occupancy_pct,
        peak_occupancy_pct,
        avg_occupancy,
        capacity,
        sample_count
      FROM birmingham_hourly_summary
      ${whereClause}
      ORDER BY bucket DESC
      LIMIT $1
    `, params);

    res.json(result.rows.reverse());
  } catch (err) {
    next(err);
  }
}
