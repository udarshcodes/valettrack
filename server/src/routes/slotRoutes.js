import { Router } from 'express';
import { getSlots, getSlotById, updateSlotStatus, getSlotTypes, updateSlotTypeRate, createSlot, recommendSlot, deleteSlot } from '../controllers/slotController.js';
import { validate } from '../middleware/validate.js';
import { slotStatusSchema, slotTypeRateSchema, idParamSchema } from '../validation/schemas.js';

const router = Router();

router.get('/types', getSlotTypes);
router.put('/types/:id', validate(idParamSchema, 'params'), validate(slotTypeRateSchema, 'body'), updateSlotTypeRate);

router.get('/recommendation', recommendSlot);
router.post('/recommend', recommendSlot);

router.get('/', getSlots);
router.post('/', createSlot);
router.get('/:id', validate(idParamSchema, 'params'), getSlotById);
router.put('/:id/status', validate(idParamSchema, 'params'), validate(slotStatusSchema, 'body'), updateSlotStatus);
router.delete('/:id', validate(idParamSchema, 'params'), deleteSlot);

export default router;

