import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import ownerRoutes from './ownerRoutes.js';
import vehicleRoutes from './vehicleRoutes.js';
import staffRoutes from './staffRoutes.js';
import slotRoutes from './slotRoutes.js';
import ticketRoutes from './ticketRoutes.js';
import analyticsRoutes from './analyticsRoutes.js';
import birminghamRoutes from './birminghamRoutes.js';
import sfparkRoutes from './sfparkRoutes.js';
import datasetRoutes from './datasetRoutes.js';
import predictionRoutes from './predictionRoutes.js';
import telemetryRoutes from './telemetryRoutes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/owners', ownerRoutes);
router.use('/vehicles', vehicleRoutes);
router.use('/staff', staffRoutes);
router.use('/slots', slotRoutes);
router.use('/tickets', ticketRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/birmingham', birminghamRoutes);
router.use('/sfpark', sfparkRoutes);
router.use('/datasets', datasetRoutes);
router.use('/predictions', predictionRoutes);
router.use('/telemetry', telemetryRoutes);

export default router;
