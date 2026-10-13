import { z } from 'zod';

export const ownerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  phone: z.string().min(7, 'Phone must be at least 7 digits').max(20),
  email: z.string().email('Invalid email address').max(100),
});

export const vehicleSchema = z.object({
  vehicle_no: z.string().min(3, 'Vehicle number must be at least 3 characters').max(20),
  type: z.string().min(2, 'Type must be at least 2 characters').max(30),
  color: z.string().min(2, 'Color must be at least 2 characters').max(30),
  owner_id: z.coerce.number().int().positive('Owner ID must be a positive integer'),
});

export const staffSchema = z.object({
  name: z.string().min(2, 'Staff name must be at least 2 characters').max(100),
  phone: z.string().min(7, 'Phone must be at least 7 digits').max(20),
  shift_timing: z.string().min(3, 'Shift timing is required').max(50),
});

export const slotTypeRateSchema = z.object({
  base_rate: z.coerce.number().nonnegative('Base rate must be non-negative'),
});

export const slotStatusSchema = z.object({
  status: z.enum(['Available', 'Occupied', 'Reserved']),
});

export const openTicketSchema = z.object({
  vehicle_no: z.string().min(2, 'Vehicle number is required'),
  slot_id: z.coerce.number().int().positive('Slot ID is required'),
  staff_id: z.coerce.number().int().positive('Staff ID is required'),
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('ID parameter must be a positive integer'),
});
