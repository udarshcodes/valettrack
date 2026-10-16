import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import csv from 'csv-parser';
import pkg from 'pg-copy-streams';
const { from: copyFrom } = pkg;
import { pool } from '../server/src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getFileChecksum(filePath) {
  if (!fs.existsSync(filePath)) return null;
  console.log('• Calculating SHA256 checksum of source ZIP archive...');
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024 * 16); // 16MB chunk
  const fd = fs.openSync(filePath, 'r');
  let bytesRead = 0;
  while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
    hash.update(buffer.subarray(0, bytesRead));
  }
  fs.closeSync(fd);
  return hash.digest('hex');
}

// Parse command line arguments:
// Default: process COMPLETE dataset (null limit)
// Explicit development / test slice: --limit <N> or SFPARK_LIMIT environment variable
function getTargetLimit() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  if (limitArg) return parseInt(limitArg.split('=')[1], 10);
  const flagIdx = process.argv.indexOf('--limit');
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return parseInt(process.argv[flagIdx + 1], 10);
  }
  if (process.env.SFPARK_LIMIT) {
    return parseInt(process.env.SFPARK_LIMIT, 10);
  }
  return null; // Full dataset by default
}

async function importSFpark() {
  const limit = getTargetLimit();
  const modeLabel = limit ? `DEVELOPMENT SLICE (${limit.toLocaleString()} records)` : 'FULL DATASET (All 7,902,291 records)';
  console.log(`=== Starting SFpark Dataset Import [${modeLabel}] ===`);

  const zipCandidates = [
    process.env.SFPARK_ZIP_PATH,
    path.resolve(__dirname, '../SFpark_ParkingSensorData_HourlyOccupancy_20112013.zip'),
    path.resolve(__dirname, '../../SFpark_ParkingSensorData_HourlyOccupancy_20112013.zip'),
    path.resolve(process.env.USERPROFILE || 'C:/Users/Udarsh', 'SFpark_ParkingSensorData_HourlyOccupancy_20112013.zip'),
    'C:/Users/Udarsh/SFpark_ParkingSensorData_HourlyOccupancy_20112013.zip'
  ].filter(Boolean);

  const csvCandidates = [
    process.env.SFPARK_CSV_PATH,
    path.resolve(__dirname, '../SFpark_ParkingSensorData_HourlyOccupancy_20112013.csv'),
    path.resolve(__dirname, '../../SFpark_ParkingSensorData_HourlyOccupancy_20112013.csv'),
    path.resolve(process.env.USERPROFILE || 'C:/Users/Udarsh', 'SFpark_ParkingSensorData_HourlyOccupancy_20112013.csv'),
    'C:/Users/Udarsh/SFpark_ParkingSensorData_HourlyOccupancy_20112013.csv'
  ].filter(Boolean);

  const zipPath = zipCandidates.find(p => fs.existsSync(p));
  const csvPath = csvCandidates.find(p => fs.existsSync(p));

  let inputStream;
  let sourceFilename = '';
  let checksum = null;
  let zipProcess = null;

  if (zipPath && fs.existsSync(zipPath)) {
    console.log(`• Found ZIP archive: ${zipPath}`);
    checksum = getFileChecksum(zipPath);
    console.log(`  Source SHA256: ${checksum}`);
    sourceFilename = path.basename(zipPath);
    zipProcess = spawn('tar', [
      '-xf',
      zipPath,
      '-O',
      'SFpark_ParkingSensorData_HourlyOccupancy_20112013.csv'
    ]);
    inputStream = zipProcess.stdout;
  } else if (csvPath && fs.existsSync(csvPath)) {
    console.log(`• Found extracted CSV: ${csvPath}`);
    checksum = getFileChecksum(csvPath);
    sourceFilename = path.basename(csvPath);
    inputStream = fs.createReadStream(csvPath);
  } else {
    throw new Error('Neither SFpark_ParkingSensorData_HourlyOccupancy_20112013.zip nor extracted CSV could be found in project or user profile directory.');
  }

  const client = await pool.connect();
  const startTime = new Date();

  const initialStatus = limit ? 'PARTIAL_DEV' : 'IN_PROGRESS';
  const manifestRes = await client.query(`
    INSERT INTO dataset_imports (
      dataset_name, source_filename, source_checksum, import_start, status
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING import_id;
  `, ['SFpark 2011-2013', sourceFilename, checksum, startTime, initialStatus]);
  const importId = manifestRes.rows[0].import_id;

  try {
    console.log('1. Preparing unlogged staging table to ensure zero data loss on interruption...');
    await client.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS sfpark_staging (
        start_time TIMESTAMPTZ NOT NULL,
        block_id VARCHAR(50) NOT NULL,
        street_name VARCHAR(100),
        block_num VARCHAR(20),
        street_block VARCHAR(100),
        area_type VARCHAR(50),
        district_name VARCHAR(50) NOT NULL,
        rate NUMERIC(6,2),
        total_time INT,
        total_occupied_time INT,
        total_vacant_time INT,
        occupancy_pct NUMERIC(5,2) NOT NULL,
        day_type VARCHAR(20),
        time_of_day VARCHAR(10)
      );
      TRUNCATE TABLE sfpark_staging;
    `);

    console.log('2. Streaming, parsing, and bulk loading via PostgreSQL COPY FROM STDIN...');
    const copyStream = client.query(copyFrom(`
      COPY sfpark_staging (
        start_time, block_id, street_name, block_num, street_block,
        area_type, district_name, rate, total_time, total_occupied_time,
        total_vacant_time, occupancy_pct, day_type, time_of_day
      ) FROM STDIN WITH (FORMAT text)
    `));
    copyStream.setMaxListeners(0);

    let sourceRowsProcessed = 0;
    let rejectedRows = 0;
    let cleanedRows = 0;
    let earliestTime = null;
    let latestTime = null;
    let isDraining = false;
    let lastLogTime = Date.now();

    await new Promise((resolve, reject) => {
      const csvStream = inputStream.pipe(csv());

      csvStream.on('data', (row) => {
        sourceRowsProcessed++;

        const startTimeDt = row.START_TIME_DT?.trim();
        if (!startTimeDt) {
          rejectedRows++;
          return;
        }

        const totalTime = parseInt(row.TOTAL_TIME, 10) || 0;
        let totalOcc = parseInt(row.TOTAL_OCCUPIED_TIME, 10) || 0;
        const totalVac = parseInt(row.TOTAL_VACANT_TIME, 10) || 0;

        // Sensor cleaning: clamp occupied time exceeding total time
        if (totalOcc > totalTime && totalTime > 0) {
          totalOcc = totalTime;
          cleanedRows++;
        }

        let occPct = 0.0;
        if (totalTime > 0) {
          occPct = Number(((Math.min(totalOcc, totalTime) / totalTime) * 100).toFixed(2));
        }

        // Meter rate: preserve blank / unmetered as NULL (\N)
        const rawRate = row.RATE?.trim();
        let rateVal = '\\N';
        if (rawRate && !isNaN(parseFloat(rawRate))) {
          rateVal = parseFloat(rawRate).toFixed(2);
        }

        const blockId = (row.BLOCK_ID || 'Unknown').replace(/[\t\n\r\\]/g, ' ');
        const streetName = (row.STREET_NAME || '').replace(/[\t\n\r\\]/g, ' ');
        const blockNum = (row.BLOCK_NUM || '').replace(/[\t\n\r\\]/g, ' ');
        const streetBlock = (row.STREET_BLOCK || '').replace(/[\t\n\r\\]/g, ' ');
        const areaType = (row.AREA_TYPE || '').replace(/[\t\n\r\\]/g, ' ');
        const districtName = (row.PM_DISTRICT_NAME || 'Unknown').replace(/[\t\n\r\\]/g, ' ');
        const dayType = (row.DAY_TYPE || '').replace(/[\t\n\r\\]/g, ' ') || '\\N';
        const timeOfDay = (row.TIME_OF_DAY || '').replace(/[\t\n\r\\]/g, ' ') || '\\N';

        const line = [
          startTimeDt,
          blockId,
          streetName,
          blockNum,
          streetBlock,
          areaType,
          districtName,
          rateVal,
          totalTime,
          totalOcc,
          totalVac,
          occPct.toFixed(2),
          dayType,
          timeOfDay,
        ].join('\t') + '\n';

        const canWrite = copyStream.write(line);
        if (!canWrite && !isDraining) {
          isDraining = true;
          csvStream.pause();
          copyStream.once('drain', () => {
            isDraining = false;
            csvStream.resume();
          });
        }

        const now = Date.now();
        if (now - lastLogTime > 4000) {
          lastLogTime = now;
          const elapsedSec = ((now - startTime.getTime()) / 1000).toFixed(1);
          const rate = Math.round(sourceRowsProcessed / elapsedSec);
          console.log(`   Processed ${sourceRowsProcessed.toLocaleString()} rows (${rate.toLocaleString()} rows/s)...`);
        }

        if (limit && sourceRowsProcessed >= limit) {
          console.log(`   Reached requested target limit of ${limit.toLocaleString()} rows.`);
          csvStream.destroy();
          if (zipProcess) zipProcess.kill();
          copyStream.end();
        }
      });

      csvStream.on('end', () => {
        copyStream.end();
      });

      copyStream.on('finish', resolve);
      copyStream.on('error', reject);
      csvStream.on('error', reject);
      if (zipProcess) {
        zipProcess.on('error', reject);
      }
    });

    console.log(`3. Verified ${sourceRowsProcessed.toLocaleString()} staged records. Validating staging table and date range...`);
    const statsRes = await client.query(`
      SELECT 
        COUNT(*) as total,
        MIN(start_time) as min_date,
        MAX(start_time) as max_date
      FROM sfpark_staging;
    `);
    const stagedCount = parseInt(statsRes.rows[0].total, 10);
    earliestTime = statsRes.rows[0].min_date;
    latestTime = statsRes.rows[0].max_date;

    if (stagedCount === 0 || !earliestTime || !latestTime) {
      throw new Error(`Staging validation failed: 0 valid records staged or invalid date boundaries. Aborting import without modifying production tables.`);
    }

    // Verify data integrity in staging before touching production hypertable
    const anomalyCheck = await client.query(`
      SELECT COUNT(*) as count 
      FROM sfpark_staging 
      WHERE occupancy_pct < 0 OR occupancy_pct > 100 OR start_time IS NULL;
    `);
    const anomalyCount = parseInt(anomalyCheck.rows[0].count, 10);
    if (anomalyCount > 0) {
      throw new Error(`Staged dataset validation failed: ${anomalyCount} invalid rows detected (negative/out-of-bounds occupancy or missing start time). Aborting import.`);
    }

    // Guardrail: Ensure limited development import cannot accidentally replace a complete production dataset
    const existingCountRes = await client.query('SELECT COUNT(*) as count FROM sfpark_readings;');
    const existingCount = parseInt(existingCountRes.rows[0].count, 10);

    const isLimitedDevImport = Boolean(limit);
    const allowDevOverwrite = process.argv.includes('--force-dev-overwrite') || process.env.ALLOW_DEV_OVERWRITE === 'true';

    if (process.env.NODE_ENV === 'production' && isLimitedDevImport) {
      const errorMsg = 'PRODUCTION SAFEGUARD: Limited development imports (--limit) are strictly forbidden in production environment.';
      console.error(`\n❌ ${errorMsg}\n`);
      await client.query(`
        UPDATE dataset_imports 
        SET status = 'FAILED', error_message = $1, import_completed = NOW()
        WHERE import_id = $2;
      `, [errorMsg, importId]);
      await client.query('TRUNCATE TABLE sfpark_staging;');
      throw new Error(errorMsg);
    }

    if (isLimitedDevImport && existingCount > 100000 && !allowDevOverwrite) {
      const errorMsg = `PROTECTION TRIGGERED: Refusing to replace complete production dataset (${existingCount.toLocaleString()} rows) with limited development slice (${stagedCount.toLocaleString()} rows). Pass --force-dev-overwrite or set ALLOW_DEV_OVERWRITE=true to intentionally overwrite in development.`;
      console.error(`\n❌ ${errorMsg}\n`);
      await client.query(`
        UPDATE dataset_imports 
        SET status = 'PROTECTED_ABORTED', error_message = $1, import_completed = NOW()
        WHERE import_id = $2;
      `, [errorMsg, importId]);
      await client.query('TRUNCATE TABLE sfpark_staging;');
      throw new Error(errorMsg);
    }

    console.log(`   Staged: ${stagedCount.toLocaleString()} rows | Date Range: ${earliestTime?.toISOString()} -> ${latestTime?.toISOString()}`);

    console.log('4. Atomically committing verified records into TimescaleDB sfpark_readings hypertable...');
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE sfpark_readings CASCADE;');
      await client.query(`
        INSERT INTO sfpark_readings (
          start_time, block_id, street_name, block_num, street_block,
          area_type, district_name, rate, total_time, total_occupied_time,
          total_vacant_time, occupancy_pct, day_type, time_of_day
        )
        SELECT 
          start_time, block_id, street_name, block_num, street_block,
          area_type, district_name, rate, total_time, total_occupied_time,
          total_vacant_time, occupancy_pct, day_type, time_of_day
        FROM sfpark_staging;
      `);
      await client.query('TRUNCATE TABLE sfpark_staging;');
      await client.query('COMMIT');
    } catch (swapErr) {
      await client.query('ROLLBACK');
      throw swapErr;
    }

    console.log('5. Refreshing TimescaleDB continuous aggregate sfpark_hourly_summary...');
    try {
      await client.query(`CALL refresh_continuous_aggregate('sfpark_hourly_summary', NULL, NULL);`);
      console.log('   Continuous aggregate refreshed successfully.');
    } catch (aggErr) {
      console.warn('   Note on aggregate refresh:', aggErr.message);
    }

    const finishTime = new Date();
    const durationSeconds = ((finishTime - startTime) / 1000).toFixed(2);
    const finalStatus = limit ? 'PARTIAL_DEV' : 'COMPLETED';

    console.log('6. Recording audit manifest into dataset_imports...');
    await client.query(`
      UPDATE dataset_imports
      SET 
        import_completed = $1,
        source_rows_processed = $2,
        rows_imported = $3,
        duplicates_ignored = 0,
        rejected_rows = $4,
        cleaned_rows = $5,
        earliest_timestamp = $6,
        latest_timestamp = $7,
        status = $8
      WHERE import_id = $9;
    `, [
      finishTime,
      sourceRowsProcessed,
      stagedCount,
      rejectedRows,
      cleanedRows,
      earliestTime,
      latestTime,
      finalStatus,
      importId,
    ]);

    console.log(`=== SFpark Dataset Import Finished in ${durationSeconds}s ===`);
    console.log({
      dataset: 'SFpark 2011-2013',
      status: finalStatus,
      sourceFilename,
      checksum,
      sourceRowsProcessed,
      rowsImported: stagedCount,
      sensorCleaningClamped: cleanedRows,
      earliestDate: earliestTime?.toISOString(),
      latestDate: latestTime?.toISOString(),
    });
  } catch (err) {
    console.error('SFpark import failed:', err.message);
    await client.query(`
      UPDATE dataset_imports
      SET status = 'FAILED', error_message = $1, import_completed = NOW()
      WHERE import_id = $2;
    `, [err.message, importId]);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

importSFpark().catch((err) => {
  console.error(err);
  process.exit(1);
});
