-- ==============================================================================
-- ValetTrack: Configuration & Application Settings Seed Script
-- Initializes system slot types and default facility slot configuration.
-- Does NOT populate fake customer records, tickets, or synthetic readings.
-- ==============================================================================

BEGIN;

-- 1. Slot Types Configuration (Standard Baseline Rates, Idempotent)
INSERT INTO slot_types (slot_type_id, type_name, base_rate) VALUES
  (1, 'Regular', 50.00),
  (2, 'Covered', 80.00),
  (3, 'EVCharging', 120.00)
ON CONFLICT (slot_type_id) DO NOTHING;

-- 2. Initial Facility Parking Spaces (24 Available Physical Slots)
-- 12 Regular (Slots 1-12), 8 Covered (Slots 13-20), 4 EV Charging (Slots 21-24)
-- Inserts missing baseline spaces, preserves custom slot types, and preserves protected statuses
INSERT INTO parking_slots (slot_id, slot_type_id, status) VALUES
  (1, 1, 'Available'),
  (2, 1, 'Available'),
  (3, 1, 'Available'),
  (4, 1, 'Available'),
  (5, 1, 'Available'),
  (6, 1, 'Available'),
  (7, 1, 'Available'),
  (8, 1, 'Available'),
  (9, 1, 'Available'),
  (10, 1, 'Available'),
  (11, 1, 'Available'),
  (12, 1, 'Available'),
  (13, 2, 'Available'),
  (14, 2, 'Available'),
  (15, 2, 'Available'),
  (16, 2, 'Available'),
  (17, 2, 'Available'),
  (18, 2, 'Available'),
  (19, 2, 'Available'),
  (20, 2, 'Available'),
  (21, 3, 'Available'),
  (22, 3, 'Available'),
  (23, 3, 'Available'),
  (24, 3, 'Available')
ON CONFLICT (slot_id) DO UPDATE
SET status = CASE 
      WHEN EXISTS (SELECT 1 FROM tickets WHERE slot_id = EXCLUDED.slot_id AND exit_time IS NULL) THEN 'Occupied'
      WHEN parking_slots.status IN ('Reserved', 'Maintenance', 'Disabled') THEN parking_slots.status
      ELSE 'Available'
    END;

-- 3. Synchronize All Relational Primary Key Sequences
SELECT fn_sync_all_sequences();

COMMIT;
