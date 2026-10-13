import { Router } from 'express';
import { getOwners, getOwnerById, createOwner, updateOwner, deleteOwner } from '../controllers/ownerController.js';
import { validate } from '../middleware/validate.js';
import { ownerSchema, idParamSchema } from '../validation/schemas.js';

const router = Router();

router.get('/', getOwners);
router.get('/:id', validate(idParamSchema, 'params'), getOwnerById);
router.post('/', validate(ownerSchema, 'body'), createOwner);
router.put('/:id', validate(idParamSchema, 'params'), validate(ownerSchema, 'body'), updateOwner);
router.delete('/:id', validate(idParamSchema, 'params'), deleteOwner);

export default router;
