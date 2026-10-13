import { Router } from 'express';
import { getStaff, createStaff, updateStaff, deleteStaff } from '../controllers/staffController.js';
import { validate } from '../middleware/validate.js';
import { staffSchema, idParamSchema } from '../validation/schemas.js';

const router = Router();

router.get('/', getStaff);
router.post('/', validate(staffSchema, 'body'), createStaff);
router.put('/:id', validate(idParamSchema, 'params'), validate(staffSchema, 'body'), updateStaff);
router.delete('/:id', validate(idParamSchema, 'params'), deleteStaff);

export default router;
