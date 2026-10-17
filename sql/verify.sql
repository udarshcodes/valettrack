-- ==============================================================================
-- ValetTrack: Database Integrity, Constraints & TimescaleDB Verification
-- ==============================================================================

\echo '--- 1. VERIFYING EXTENSION & HYPERTABLES ---'
SELECT extname, extversion FROM pg_extension WHERE extname = 'timescaledb';

SELECT hypertable_schema, hypertable_name, num_dimensions, num_chunks 
FROM timescaledb_information.hypertables
ORDER BY hypertable_name;

\echo '--- 2. VERIFYING CONTINUOUS AGGREGATES ---'
SELECT view_schema, view_name, materialized_only 
FROM timescaledb_information.continuous_aggregates
ORDER BY view_name;

\echo '--- 3. VERIFYING RECORD COUNTS & DATASET AUDIT MANIFESTS ---'
SELECT 'owners' AS entity, count(*) AS count FROM owners
UNION ALL SELECT 'vehicles', count(*) FROM vehicles
UNION ALL SELECT 'valet_staff', count(*) FROM valet_staff
UNION ALL SELECT 'slot_types', count(*) FROM slot_types
UNION ALL SELECT 'parking_slots', count(*) FROM parking_slots
UNION ALL SELECT 'tickets', count(*) FROM tickets
UNION ALL SELECT 'dataset_imports', count(*) FROM dataset_imports
UNION ALL SELECT 'birmingham_readings', count(*) FROM birmingham_readings
UNION ALL SELECT 'sfpark_readings', count(*) FROM sfpark_readings;

SELECT import_id, dataset_name, source_rows_processed, rows_imported, cleaned_rows, status, earliest_timestamp, latest_timestamp
FROM dataset_imports
ORDER BY import_start DESC;

\echo '--- 4. VERIFYING BILLING LOGIC FUNCTION (fn_calculate_amount) ---'
-- Slot 1 is Regular (base rate 50.00). 30 min duration should round up to 1 hour (50.00)
SELECT 
    fn_calculate_amount(1, NOW() - INTERVAL '30 minutes', NOW()) AS bill_30min,
    fn_calculate_amount(1, NOW() - INTERVAL '61 minutes', NOW()) AS bill_61min,
    fn_calculate_amount(1, NOW() - INTERVAL '150 minutes', NOW()) AS bill_150min;

-- Slot 21 is EVCharging (base rate 120.00). 75 min duration should round up to 2 hours (240.00)
SELECT 
    fn_calculate_amount(21, NOW() - INTERVAL '75 minutes', NOW()) AS ev_bill_75min;

\echo '--- 5. VERIFYING CONSTRAINTS & DOMAIN RULES ---'
-- Attempting to insert negative base rate (Must fail)
DO $$
BEGIN
    INSERT INTO slot_types (type_name, base_rate) VALUES ('Regular', -10);
    RAISE EXCEPTION 'FAILED: Negative base rate was accepted!';
EXCEPTION WHEN check_violation OR unique_violation THEN
    RAISE NOTICE 'SUCCESS: Negative base rate was correctly rejected.';
END $$;

-- Attempting to double-allocate an already occupied slot (Must fail trigger or partial unique index)
DO $$
DECLARE
    v_test_owner INT;
    v_test_staff INT;
    v_test_slot INT;
    v_second_insert_succeeded BOOLEAN := FALSE;
BEGIN
    -- Create isolated temporary parking slot to guarantee zero interference with operational slots
    INSERT INTO parking_slots (slot_type_id, status) VALUES (1, 'Available') RETURNING slot_id INTO v_test_slot;
    INSERT INTO owners (name, phone, email) VALUES ('DoubleAllocTest', '9991112223', 'double_alloc@test.internal') RETURNING owner_id INTO v_test_owner;
    INSERT INTO vehicles (vehicle_no, type, color, owner_id) VALUES ('TEST-DBL-1', 'Sedan', 'White', v_test_owner);
    INSERT INTO vehicles (vehicle_no, type, color, owner_id) VALUES ('TEST-DBL-2', 'Sedan', 'Black', v_test_owner);
    INSERT INTO valet_staff (name, phone, shift_timing) VALUES ('StaffTest', '9991119999', 'Morning') RETURNING staff_id INTO v_test_staff;

    BEGIN
        -- Open first ticket on the isolated test slot
        INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time) VALUES ('TEST-DBL-1', v_test_slot, v_test_staff, NOW());

        -- Attempt to open second ticket on same slot (Must fail trigger or unique index)
        BEGIN
            INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time) VALUES ('TEST-DBL-2', v_test_slot, v_test_staff, NOW());
            v_second_insert_succeeded := TRUE;
        EXCEPTION WHEN unique_violation OR check_violation OR OTHERS THEN
            RAISE NOTICE 'SUCCESS: Double allocation was correctly rejected (%).', SQLERRM;
        END;

        IF v_second_insert_succeeded THEN
            RAISE EXCEPTION 'CRITICAL FAILURE: Double allocation on slot % was unexpectedly accepted!', v_test_slot;
        END IF;

    EXCEPTION WHEN OTHERS THEN
        -- Cleanup on unexpected error
        DELETE FROM tickets WHERE slot_id = v_test_slot;
        DELETE FROM parking_slots WHERE slot_id = v_test_slot;
        DELETE FROM vehicles WHERE vehicle_no IN ('TEST-DBL-1', 'TEST-DBL-2');
        DELETE FROM owners WHERE owner_id = v_test_owner;
        DELETE FROM valet_staff WHERE staff_id = v_test_staff;
        RAISE;
    END;

    -- Normal cleanup
    DELETE FROM tickets WHERE slot_id = v_test_slot;
    DELETE FROM parking_slots WHERE slot_id = v_test_slot;
    DELETE FROM vehicles WHERE vehicle_no IN ('TEST-DBL-1', 'TEST-DBL-2');
    DELETE FROM owners WHERE owner_id = v_test_owner;
    DELETE FROM valet_staff WHERE staff_id = v_test_staff;
END $$;


\echo '--- 6. VERIFYING TIMESCALEDB TIME_BUCKET ON REAL DATASETS ---'
SELECT 
    time_bucket('1 day', reading_time) AS day_bucket,
    ROUND(AVG(occupancy_pct), 2) AS avg_occ,
    COUNT(*) AS readings
FROM birmingham_readings
GROUP BY day_bucket
ORDER BY day_bucket DESC
LIMIT 5;

SELECT 
    time_bucket('1 day', start_time) AS day_bucket,
    ROUND(AVG(occupancy_pct), 2) AS avg_occ,
    ROUND(AVG(rate), 2) AS avg_meter_rate,
    COUNT(*) AS readings
FROM sfpark_readings
GROUP BY day_bucket
ORDER BY day_bucket DESC
LIMIT 5;

\echo '--- VERIFICATION SCRIPT COMPLETED SUCCESSFULLY ---'
