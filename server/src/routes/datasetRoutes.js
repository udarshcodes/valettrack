import { Router } from 'express';
import { getDatasetManifests, getDatasetsGlobalSummary } from '../controllers/datasetController.js';

const router = Router();

router.get('/manifest', getDatasetManifests);
router.get('/summary', getDatasetsGlobalSummary);

export default router;
