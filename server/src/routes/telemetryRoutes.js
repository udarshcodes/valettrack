import { Router } from 'express';
import { authenticateTelemetry } from '../middleware/authTelemetry.js';
import { ingestTelemetry, getTelemetryStatus, getRecentTelemetry } from '../controllers/telemetryController.js';

const router = Router();

router.get('/status', getTelemetryStatus);
router.get('/recent', getRecentTelemetry);
router.post('/readings', authenticateTelemetry, ingestTelemetry);

export default router;
