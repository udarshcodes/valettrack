#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load environment configuration (.env) if present
const envPath = path.resolve(rootDir, '.env');
if (typeof process.loadEnvFile === 'function' && fs.existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {}
} else if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const sqlFileArg = process.argv[2];
if (!sqlFileArg) {
  console.error('[run_sql] Error: SQL file path must be specified.');
  console.error('[run_sql] Usage: node scripts/run_sql.js <path/to/file.sql>');
  process.exit(1);
}

const sqlFilePath = path.isAbsolute(sqlFileArg) ? sqlFileArg : path.resolve(rootDir, sqlFileArg);
if (!fs.existsSync(sqlFilePath)) {
  console.error(`[run_sql] Error: SQL file not found at: ${sqlFilePath}`);
  process.exit(1);
}

const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || '5432';
const dbUser = process.env.DB_USER || 'valettrack';
const dbPassword = process.env.DB_PASSWORD || 'valettrack_dev_password';
const dbName = process.env.DB_NAME || 'valettrack_db';

console.log(`[run_sql] Preparing execution of ${path.relative(rootDir, sqlFilePath)}`);
console.log(`[run_sql] Target Database: ${dbUser}@${dbHost}:${dbPort}/${dbName}`);

function findTimescaleContainer() {
  try {
    const inspect = execSync('docker inspect -f "{{.State.Running}}" valettrack-timescaledb', {
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf-8'
    }).trim();
    if (inspect === 'true') {
      return 'valettrack-timescaledb';
    }
  } catch {
    // Named container not found or not running
  }

  try {
    const output = execSync('docker ps --filter "status=running" --format "{{.ID}}\t{{.Image}}\t{{.Names}}"', {
      stdio: ['pipe', 'pipe', 'ignore'],
      encoding: 'utf-8'
    });
    const lines = output.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [id, image, name] = line.split('\t');
      if (image && (image.includes('timescale') || (name && name.includes('timescaledb')))) {
        return id;
      }
    }
  } catch {
    // Docker command unavailable or daemon not running
  }

  return null;
}

function hasLocalPsql() {
  try {
    execSync(process.platform === 'win32' ? 'where psql' : 'which psql', {
      stdio: ['pipe', 'pipe', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

async function executeViaDocker(containerId) {
  console.log(`[run_sql] Executing via TimescaleDB Docker container [${containerId}]...`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      [
        'exec',
        '-i',
        '-e', `PGPASSWORD=${dbPassword}`,
        containerId,
        'psql',
        '-U', dbUser,
        '-d', dbName,
        '-v', 'ON_ERROR_STOP=1'
      ],
      {
        stdio: ['pipe', 'inherit', 'inherit'],
        cwd: rootDir
      }
    );

    const stream = fs.createReadStream(sqlFilePath);
    stream.pipe(child.stdin);

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`psql inside docker container exited with code ${code}`));
      }
      resolve();
    });
  });
}

async function executeViaLocalPsql() {
  console.log('[run_sql] Executing via local host psql client...');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'psql',
      [
        '-h', dbHost,
        '-p', String(dbPort),
        '-U', dbUser,
        '-d', dbName,
        '-v', 'ON_ERROR_STOP=1'
      ],
      {
        stdio: ['pipe', 'inherit', 'inherit'],
        cwd: rootDir,
        env: {
          ...process.env,
          PGPASSWORD: dbPassword
        }
      }
    );

    const stream = fs.createReadStream(sqlFilePath);
    stream.pipe(child.stdin);

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`local psql exited with code ${code}`));
      }
      resolve();
    });
  });
}

async function executeViaPgClient() {
  console.log('[run_sql] Executing via Node.js pg client...');
  const client = new pg.Client({
    host: dbHost,
    port: parseInt(dbPort, 10),
    user: dbUser,
    password: dbPassword,
    database: dbName
  });

  client.on('notice', (msg) => {
    console.log(`NOTICE: ${msg.message}`);
  });

  await client.connect();

  try {
    const content = fs.readFileSync(sqlFilePath, 'utf-8');
    
    // Check if the script contains psql metacommands like \echo
    const lines = content.split('\n');
    let currentSql = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('\\echo')) {
        // Execute any accumulated SQL before printing the echo message
        if (currentSql.trim()) {
          await client.query(currentSql);
          currentSql = '';
        }
        // Extract and display echo message
        const match = rawLine.match(/\\echo\s+['"]?(.*?)['"]?$/);
        const msg = match ? match[1] : rawLine.replace(/\\echo\s*/, '');
        console.log(msg);
      } else {
        currentSql += rawLine + '\n';
      }
    }

    if (currentSql.trim()) {
      await client.query(currentSql);
    }

    console.log('[run_sql] SQL file successfully executed via pg client.');
  } finally {
    await client.end();
  }
}

async function runWithRetry(fn, maxAttempts = 5, delayMs = 1500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err.message || '';
      const isTransient = msg.includes('the database system is starting up') ||
                          msg.includes('Connection refused') ||
                          msg.includes('could not connect to server') ||
                          msg.includes('57P03');
      if (attempt < maxAttempts && isTransient) {
        console.warn(`[run_sql] Database startup in progress (${msg}). Retrying ${attempt}/${maxAttempts} in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  try {
    await runWithRetry(async () => {
      const containerId = findTimescaleContainer();
      if (containerId) {
        await executeViaDocker(containerId);
      } else if (hasLocalPsql()) {
        await executeViaLocalPsql();
      } else {
        await executeViaPgClient();
      }
    });
    console.log(`[run_sql] Successfully completed execution of ${path.basename(sqlFilePath)}`);
  } catch (err) {
    console.error(`[run_sql] Execution failed: ${err.message}`);
    process.exit(1);
  }
}

main();
