import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import apiRouter from './routes/api.js';
import { errorHandler } from './middleware/errorHandler.js';

export const app = express();

const allowedOrigins = config.clientOrigin
  ? config.clientOrigin.split(',').map(s => s.trim())
  : ['http://localhost:5174'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests with no origin (e.g. curl, sensor gateways)
    if (!origin) return callback(null, true);
    if (config.nodeEnv !== 'production') {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy violation: Origin '${origin}' is not allowed.`));
  },
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (config.nodeEnv === 'development') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[${req.method}] ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    });
    next();
  });
}

app.use('/api', apiRouter);

app.get('/', (req, res) => {
  res.json({
    name: 'ValetTrack TimescaleDB API',
    status: 'online',
    version: '1.0.0',
    documentation: '/api/health',
    endpoints: [
      '/api/health',
      '/api/dashboard/summary',
      '/api/slots',
      '/api/slots/types',
      '/api/owners',
      '/api/vehicles',
      '/api/staff',
      '/api/tickets',
      '/api/analytics/hourly',
      '/api/analytics/daily',
      '/api/analytics/pricing-predictions',
      '/api/birmingham/summary',
      '/api/sfpark/summary'
    ]
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: 'NotFound',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

app.use(errorHandler);
