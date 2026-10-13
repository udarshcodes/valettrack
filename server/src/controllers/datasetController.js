import { query } from '../db/index.js';

export async function getDatasetManifests(req, res, next) {
  try {
    const manifests = await query(`
      SELECT * FROM dataset_imports
      ORDER BY import_start DESC;
    `);
    res.json(manifests.rows);
  } catch (err) {
    next(err);
  }
}

export async function getDatasetsGlobalSummary(req, res, next) {
  try {
    const bham = await query(`
      SELECT 
        COUNT(*) as total_readings,
        COUNT(DISTINCT system_code_number) as entities_count,
        ROUND(AVG(occupancy_pct), 1) as avg_occupancy,
        MIN(reading_time) as min_date,
        MAX(reading_time) as max_date
      FROM birmingham_readings
    `);

    const sfpark = await query(`
      SELECT 
        COUNT(*) as total_readings,
        COUNT(DISTINCT district_name) as entities_count,
        ROUND(AVG(occupancy_pct), 1) as avg_occupancy,
        ROUND(AVG(rate), 2) as avg_rate,
        MIN(start_time) as min_date,
        MAX(start_time) as max_date
      FROM sfpark_readings
    `);

    const manifests = await query(`
      SELECT * FROM dataset_imports ORDER BY import_start DESC LIMIT 10
    `);

    const bCount = parseInt(bham.rows[0].total_readings, 10) || 0;
    const sCount = parseInt(sfpark.rows[0].total_readings, 10) || 0;

    res.json({
      birmingham: bham.rows[0],
      sfpark: sfpark.rows[0],
      manifests: manifests.rows,
      totalObservations: bCount + sCount
    });
  } catch (err) {
    next(err);
  }
}
