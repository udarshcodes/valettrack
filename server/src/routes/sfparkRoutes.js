import { Router } from 'express';
import { 
  getSFparkSummary, 
  getSFparkHourly, 
  getSFparkPricingAnalysis, 
  getSFparkPricingRecommendations 
} from '../controllers/sfparkController.js';

const router = Router();

router.get('/summary', getSFparkSummary);
router.get('/hourly', getSFparkHourly);
router.get('/pricing-analysis', getSFparkPricingAnalysis);
router.get('/pricing-recommendations', getSFparkPricingRecommendations);

export default router;
