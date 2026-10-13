import { query } from '../db/index.js';

export async function getHealth(req, res, next) {
  try {
    const dbRes = await query(`
      SELECT 
        version() as pg_version, 
        (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') as timescaledb_version,
        NOW() as current_db_time
    `);

    const hypertablesRes = await query(`
      SELECT count(*) as hypertable_count 
      FROM timescaledb_information.hypertables
    `);

    const summaryRes = await query(`
      SELECT 
        (SELECT count(*) FROM parking_slots) as slots_count,
        (SELECT count(*) FROM tickets) as tickets_count,
        (SELECT count(*) FROM occupancy_readings) as readings_count,
        (SELECT count(*) FROM birmingham_readings) as birmingham_count,
        (SELECT count(*) FROM sfpark_readings) as sfpark_count
    `);

    res.json({
      status: 'UP',
      database: {
        connected: true,
        type: 'TimescaleDB / PostgreSQL',
        postgresVersion: dbRes.rows[0].pg_version,
        timescaleVersion: dbRes.rows[0].timescaledb_version,
        dbTime: dbRes.rows[0].current_db_time,
        hypertables: parseInt(hypertablesRes.rows[0].hypertable_count, 10),
        counts: summaryRes.rows[0]
      },
      server: {
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(503).json({
      status: 'DOWN',
      database: {
        connected: false,
        error: err.message
      },
      timestamp: new Date().toISOString()
    });
  }
}
