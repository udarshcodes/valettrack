import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const rawDbPassword = process.env.DB_PASSWORD;

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
  }
};
