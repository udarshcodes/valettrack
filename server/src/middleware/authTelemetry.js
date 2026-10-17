import crypto from 'crypto';
import { config } from '../config/env.js';

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function authenticateTelemetry(req, res, next) {
  const headerKey = req.headers['x-telemetry-key'];
  const authHeader = req.headers['authorization'];
  
  let key = headerKey;
  if (!key && authHeader && authHeader.startsWith('Bearer ')) {
    key = authHeader.slice(7).trim();
  }

  const expectedKey = config.telemetryApiKey;
  if (!key || !expectedKey || !safeCompare(key, expectedKey)) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'InvalidTelemetryKey',
      message: 'Invalid or missing telemetry authorization credentials. Ingestion endpoint requires a valid x-telemetry-key header or Bearer token.'
    });
  }

  next();
}
