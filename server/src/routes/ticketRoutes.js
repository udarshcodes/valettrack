import { Router } from 'express';
import { getTickets, getTicketById, openTicket, closeTicket } from '../controllers/ticketController.js';
import { validate } from '../middleware/validate.js';
import { openTicketSchema, idParamSchema } from '../validation/schemas.js';

const router = Router();

router.get('/', getTickets);
router.get('/:id', validate(idParamSchema, 'params'), getTicketById);
router.post('/', validate(openTicketSchema, 'body'), openTicket);
router.post('/:id/close', validate(idParamSchema, 'params'), closeTicket);

export default router;
