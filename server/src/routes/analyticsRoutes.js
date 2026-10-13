import { Router } from 'express';
import { 
  getHourlyOccupancy, 
  getDailyOccupancy, 
  getPeakDemandByHour, 
  getSlotTypeOccupancy, 
  getPricingPredictions, 
  getOccupancyPredictions,
  getContinuousAggregateSummary,
  getFacilityPricingRecommendations
} from '../controllers/analyticsController.js';

const router = Router();

router.get('/hourly', getHourlyOccupancy);
router.get('/daily', getDailyOccupancy);
router.get('/peak-demand', getPeakDemandByHour);
router.get('/slot-types', getSlotTypeOccupancy);
router.get('/pricing-predictions', getPricingPredictions);
router.get('/occupancy-predictions', getOccupancyPredictions);
router.get('/continuous-aggregate', getContinuousAggregateSummary);
router.get('/facility-pricing-recommendations', getFacilityPricingRecommendations);

export default router;
