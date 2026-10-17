import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const rawDbPassword = process.env.DB_PASSWORD;
const rawTelemetryKey = process.env.TELEMETRY_API_KEY;

// Security safeguard: Never silently fall back to a public or default password in production
if (isProd) {
  const disallowedPasswords = [
    'valettrack_secret',
    'valettrack_dev_password',
    'your_secure_password_here',
    'password',
    'admin',
    'root'
  ];
  if (!rawDbPassword || disallowedPasswords.includes(rawDbPassword.toLowerCase())) {
    throw new Error(
      'SECURITY ERROR: In production mode (NODE_ENV=production), DB_PASSWORD must be explicitly configured with a secure password and cannot use default or placeholder credentials.'
    );
  }

  const disallowedTelemetryKeys = [
    'valettrack_telemetry_dev_key',
    'valettrack_live_sensor_key_2026',
    'your_telemetry_api_key_here',
    'your_secure_telemetry_key_here',
    'telemetry_key',
    'default',
    'secret',
    'admin',
    'password'
  ];
  if (!rawTelemetryKey || disallowedTelemetryKeys.includes(rawTelemetryKey.toLowerCase()) || rawTelemetryKey.length < 16) {
    throw new Error(
      'SECURITY ERROR: In production mode (NODE_ENV=production), TELEMETRY_API_KEY must be explicitly configured with a secure key (minimum 16 characters) and cannot use default or placeholder credentials.'
    );
  }
}

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5174',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'valettrack',
    password: rawDbPassword || 'valettrack_dev_password',
    database: process.env.DB_NAME || 'valettrack_db',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  telemetryApiKey: rawTelemetryKey || 'valettrack_telemetry_dev_key'
};
