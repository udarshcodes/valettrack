import { Router } from 'express';
import { getVehicles, getVehicleByNo, createVehicle, updateVehicle, deleteVehicle } from '../controllers/vehicleController.js';
import { validate } from '../middleware/validate.js';
import { vehicleSchema } from '../validation/schemas.js';

const router = Router();

router.get('/', getVehicles);
router.get('/:vehicle_no', getVehicleByNo);
router.post('/', validate(vehicleSchema, 'body'), createVehicle);
router.put('/:vehicle_no', validate(vehicleSchema, 'body'), updateVehicle);
router.delete('/:vehicle_no', deleteVehicle);

export default router;
