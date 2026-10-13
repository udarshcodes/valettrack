import { Router } from 'express';
import { getBirminghamSummary, getBirminghamHourly } from '../controllers/birminghamController.js';

const router = Router();

router.get('/summary', getBirminghamSummary);
router.get('/hourly', getBirminghamHourly);

export default router;
