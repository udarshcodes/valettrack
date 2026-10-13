import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';
import pkg from 'pg-copy-streams';
const { from: copyFrom } = pkg;
import { pool } from '../server/src/db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getFileChecksum(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const hash = crypto.createHash('sha256');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

async function importBirmingham() {
  console.log('=== Starting Real Birmingham Dataset Import ===');
  const zipPath = path.resolve(__dirname, '../parking+birmingham.zip');
  const csvPath = path.resolve(__dirname, '../data/birmingham/dataset.csv');

  let inputStream;
  let sourceFilename = '';
  let checksum = null;
  let zipProcess = null;

  if (fs.existsSync(zipPath)) {
    console.log(`• Found ZIP archive: ${zipPath}`);
    checksum = getFileChecksum(zipPath);
    sourceFilename = 'parking+birmingham.zip (dataset.csv)';
    zipProcess = spawn('tar', ['-xf', zipPath, '-O', 'dataset.csv']);
    inputStream = zipProcess.stdout;
  } else if (fs.existsSync(csvPath)) {
    console.log(`• Found extracted CSV: ${csvPath}`);
    checksum = getFileChecksum(csvPath);
    sourceFilename = 'data/birmingham/dataset.csv';
    inputStream = fs.createReadStream(csvPath);
  } else {
    throw new Error('Neither parking+birmingham.zip nor data/birmingham/dataset.csv could be found.');
  }

  const client = await pool.connect();
  const startTime = new Date();

  const manifestRes = await client.query(`
    INSERT INTO dataset_imports (
      dataset_name, source_filename, source_checksum, import_start, status
    ) VALUES ($1, $2, $3, $4, 'IN_PROGRESS')
    RETURNING import_id;
  `, ['Birmingham 2016', sourceFilename, checksum, startTime]);
  const importId = manifestRes.rows[0].import_id;

  try {
    console.log('1. Creating unlogged staging table to guarantee zero data loss on failure...');
    await client.query(`
      CREATE UNLOGGED TABLE IF NOT EXISTS birmingham_staging (
        reading_time TIMESTAMPTZ NOT NULL,
        system_code_number VARCHAR(50) NOT NULL,
        capacity INT NOT NULL,
        occupancy INT NOT NULL,
        occupancy_pct NUMERIC(5,2) NOT NULL
      );
      TRUNCATE TABLE birmingham_staging;
    `);

    console.log('2. Streaming and bulk loading dataset rows...');
    const copyStream = client.query(copyFrom(`
      COPY birmingham_staging (
        reading_time, system_code_number, capacity, occupancy, occupancy_pct
      ) FROM STDIN WITH (FORMAT text)
    `));

    const rl = readline.createInterface({
      input: inputStream,
      crlfDelay: Infinity,
    });

    let headerSeen = false;
    let sourceRowsProcessed = 0;
    let rejectedRows = 0;
    let cleanedRows = 0;
    let earliestTime = null;
    let latestTime = null;

    copyStream.setMaxListeners(0);

    let isDraining = false;
    await new Promise((resolve, reject) => {
      rl.on('line', (line) => {
        if (!headerSeen) {
          headerSeen = true;
          return;
        }

        const trimmed = line.trim();
        if (!trimmed) return;

        sourceRowsProcessed++;
        const parts = trimmed.split(',');
        if (parts.length < 4) {
          rejectedRows++;
          return;
        }

        const code = parts[0]?.trim();
        const capacity = parseInt(parts[1]?.trim(), 10);
        let occupancy = parseInt(parts[2]?.trim(), 10);
        const dateStr = parts[3]?.trim();

        if (!code || isNaN(capacity) || isNaN(occupancy) || !dateStr) {
          rejectedRows++;
          return;
        }

        // Sensor cleaning: clamp negative occupancy glitch to 0
        if (occupancy < 0) {
          occupancy = 0;
          cleanedRows++;
        }

        let occupancyPct = 0;
        if (capacity > 0) {
          occupancyPct = Number(((Math.min(occupancy, capacity) / capacity) * 100).toFixed(2));
        }

        const readingDate = new Date(dateStr);
        if (isNaN(readingDate.getTime())) {
          rejectedRows++;
          return;
        }

        if (!earliestTime || readingDate < earliestTime) earliestTime = readingDate;
        if (!latestTime || readingDate > latestTime) latestTime = readingDate;

        const rowLine = `${dateStr}\t${code}\t${capacity}\t${occupancy}\t${occupancyPct.toFixed(2)}\n`;
        const canWrite = copyStream.write(rowLine);
        if (!canWrite && !isDraining) {
          isDraining = true;
          rl.pause();
          copyStream.once('drain', () => {
            isDraining = false;
            rl.resume();
          });
        }
      });

      rl.on('close', () => {
        copyStream.end();
      });

      copyStream.on('finish', resolve);
      copyStream.on('error', reject);
      rl.on('error', reject);
      if (zipProcess) {
        zipProcess.on('error', reject);
      }
    });

    console.log(`   Processed ${sourceRowsProcessed} source rows (clamped ${cleanedRows} sensor glitches, ${rejectedRows} rejected).`);

    console.log('3. Validating staged records and atomically committing into TimescaleDB hypertable...');
    const stagingCheck = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN occupancy_pct < 0 OR occupancy_pct > 100 THEN 1 END) as out_of_bounds,
        MIN(reading_time) as min_time,
        MAX(reading_time) as max_time
      FROM birmingham_staging;
    `);
    const totalStaged = parseInt(stagingCheck.rows[0].total, 10);
    const outOfBounds = parseInt(stagingCheck.rows[0].out_of_bounds, 10);
    earliestTime = stagingCheck.rows[0].min_time;
    latestTime = stagingCheck.rows[0].max_time;

    if (totalStaged === 0 || outOfBounds > 0 || !earliestTime || !latestTime) {
      throw new Error(`Birmingham staging validation failed: staged ${totalStaged} rows, ${outOfBounds} out-of-bounds rows. Aborting.`);
    }

    let importedCount = 0;
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE birmingham_readings CASCADE;');
      const insertRes = await client.query(`
        INSERT INTO birmingham_readings (
          reading_time, system_code_number, capacity, occupancy, occupancy_pct
        )
        SELECT reading_time, system_code_number, capacity, occupancy, occupancy_pct
        FROM birmingham_staging;
      `);
      importedCount = insertRes.rowCount;
      await client.query('TRUNCATE TABLE birmingham_staging;');
      await client.query('COMMIT');
    } catch (swapErr) {
      await client.query('ROLLBACK');
      throw swapErr;
    }

    console.log('4. Refreshing TimescaleDB continuous aggregate birmingham_hourly_summary...');
    await client.query(`CALL refresh_continuous_aggregate('birmingham_hourly_summary', NULL, NULL);`);

    const finishTime = new Date();
    const durationSeconds = ((finishTime - startTime) / 1000).toFixed(2);

    console.log('5. Recording audit manifest into dataset_imports...');
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
        status = 'COMPLETED'
      WHERE import_id = $8;
    `, [
      finishTime,
      sourceRowsProcessed,
      importedCount,
      rejectedRows,
      cleanedRows,
      earliestTime,
      latestTime,
      importId,
    ]);

    console.log(`=== Birmingham Import Completed Successfully in ${durationSeconds}s ===`);
    console.log({
      dataset: 'Birmingham 2016',
      sourceFilename,
      checksum,
      sourceRows: sourceRowsProcessed,
      importedRows: importedCount,
      clampedNegativeGlitchRows: cleanedRows,
      dateRange: `${earliestTime?.toISOString()} -> ${latestTime?.toISOString()}`,
    });
  } catch (err) {
    console.error('Birmingham import failed:', err.message);
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

importBirmingham().catch((err) => {
  console.error(err);
  process.exit(1);
});
