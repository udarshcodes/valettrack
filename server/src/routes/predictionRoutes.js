import { Router } from 'express';
import { getModelStatus, runPredictionInference } from '../controllers/predictionController.js';
import { getOccupancyPredictions, getPricingPredictions } from '../controllers/analyticsController.js';

const router = Router();

router.get('/status', getModelStatus);
router.post('/generate', runPredictionInference);
router.get('/occupancy', getOccupancyPredictions);
router.get('/pricing', getPricingPredictions);

export default router;
