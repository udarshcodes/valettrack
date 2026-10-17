import { config } from '../config/env.js';

export function authenticateTelemetry(req, res, next) {
  const headerKey = req.headers['x-telemetry-key'];
  const authHeader = req.headers['authorization'];
  
  let key = headerKey;
  if (!key && authHeader && authHeader.startsWith('Bearer ')) {
    key = authHeader.slice(7).trim();
  }

  if (!key || key !== config.telemetryApiKey) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'InvalidTelemetryKey',
      message: 'Invalid or missing telemetry authorization credentials. Ingestion endpoint requires a valid x-telemetry-key header or Bearer token.'
    });
  }

  next();
}
