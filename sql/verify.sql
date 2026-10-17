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
DO $$
DECLARE
    v_bill_30 NUMERIC;
    v_bill_61 NUMERIC;
    v_bill_150 NUMERIC;
    v_ev_bill_75 NUMERIC;
BEGIN
    -- Slot 1 is Regular (base rate 50.00). 30 min duration should round up to 1 hour (50.00)
    v_bill_30 := fn_calculate_amount(1, NOW() - INTERVAL '30 minutes', NOW());
    IF v_bill_30 <> 50.00 THEN
        RAISE EXCEPTION 'Billing assertion failed for 30min stay: expected 50.00, got %', v_bill_30;
    END IF;

    -- 61 min duration should round up to 2 hours (100.00)
    v_bill_61 := fn_calculate_amount(1, NOW() - INTERVAL '61 minutes', NOW());
    IF v_bill_61 <> 100.00 THEN
        RAISE EXCEPTION 'Billing assertion failed for 61min stay: expected 100.00, got %', v_bill_61;
    END IF;

    -- 150 min duration should round up to 3 hours (150.00)
    v_bill_150 := fn_calculate_amount(1, NOW() - INTERVAL '150 minutes', NOW());
    IF v_bill_150 <> 150.00 THEN
        RAISE EXCEPTION 'Billing assertion failed for 150min stay: expected 150.00, got %', v_bill_150;
    END IF;

    -- Slot 21 is EVCharging (base rate 120.00). 75 min duration should round up to 2 hours (240.00)
    v_ev_bill_75 := fn_calculate_amount(21, NOW() - INTERVAL '75 minutes', NOW());
    IF v_ev_bill_75 <> 240.00 THEN
        RAISE EXCEPTION 'Billing assertion failed for EV 75min stay: expected 240.00, got %', v_ev_bill_75;
    END IF;

    RAISE NOTICE 'SUCCESS: fn_calculate_amount assertions passed (30m=₹50, 61m=₹100, 150m=₹150, EV 75m=₹240).';
END $$;

\echo '--- 5. VERIFYING CONSTRAINTS & DOMAIN RULES ---'
-- Attempting to set negative base rate (Must fail check constraint chk_slottype_rate)
DO $$
DECLARE
    v_sqlstate TEXT;
    v_constraint TEXT;
BEGIN
    UPDATE slot_types SET base_rate = -10.00 WHERE slot_type_id = 1;
    RAISE EXCEPTION 'CRITICAL FAILURE: Negative base rate was accepted!';
EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
    IF v_constraint IS NOT NULL AND v_constraint <> 'chk_slottype_rate' THEN
        RAISE EXCEPTION 'UNEXPECTED CHECK CONSTRAINT VIOLATION: Expected chk_slottype_rate, got % (SQLSTATE %)', v_constraint, v_sqlstate;
    END IF;
    RAISE NOTICE 'SUCCESS: Negative base rate was correctly rejected by constraint chk_slottype_rate (SQLSTATE %).', v_sqlstate;
END $$;

-- Attempting to double-allocate an already occupied slot
DO $$
DECLARE
    v_test_owner INT;
    v_test_staff INT;
    v_test_slot INT;
    v_ticket_1 INT;
    v_ticket_2 INT;
    v_second_insert_succeeded BOOLEAN := FALSE;
    v_caught_expected_rejection BOOLEAN := FALSE;
    v_sqlstate TEXT;
    v_errmsg TEXT;
    v_constraint TEXT;
BEGIN
    -- Create isolated temporary parking slot to guarantee zero interference with operational slots
    INSERT INTO parking_slots (slot_type_id, status) VALUES (1, 'Available') RETURNING slot_id INTO v_test_slot;
    INSERT INTO owners (name, phone, email) VALUES ('DoubleAllocAudit', '9991112223', 'double_alloc_audit@test.internal') RETURNING owner_id INTO v_test_owner;
    INSERT INTO vehicles (vehicle_no, type, color, owner_id) VALUES ('TEST-DBL-1', 'Sedan', 'White', v_test_owner);
    INSERT INTO vehicles (vehicle_no, type, color, owner_id) VALUES ('TEST-DBL-2', 'Sedan', 'Black', v_test_owner);
    INSERT INTO valet_staff (name, phone, shift_timing) VALUES ('StaffTest', '9991119999', 'Morning') RETURNING staff_id INTO v_test_staff;

    BEGIN
        -- Open first ticket on the isolated test slot
        INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time) 
        VALUES ('TEST-DBL-1', v_test_slot, v_test_staff, NOW()) 
        RETURNING ticket_id INTO v_ticket_1;

        -- Attempt to open second ticket on same slot with different vehicle
        -- Must fail either trigger trg_ticket_before_insert (SQLSTATE P0001) or uq_active_slot_ticket (SQLSTATE 23505)
        BEGIN
            INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time) 
            VALUES ('TEST-DBL-2', v_test_slot, v_test_staff, NOW()) 
            RETURNING ticket_id INTO v_ticket_2;
            v_second_insert_succeeded := TRUE;
        EXCEPTION 
            WHEN raise_exception THEN
                GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_errmsg = MESSAGE_TEXT;
                IF v_errmsg LIKE '%not available for allocation%' THEN
                    v_caught_expected_rejection := TRUE;
                    RAISE NOTICE 'SUCCESS: Double allocation correctly rejected by trigger trg_ticket_before_insert (SQLSTATE %: %)', v_sqlstate, v_errmsg;
                ELSE
                    RAISE EXCEPTION 'UNEXPECTED TRIGGER ERROR during allocation: SQLSTATE %, Message: %', v_sqlstate, v_errmsg;
                END IF;
            WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_errmsg = MESSAGE_TEXT;
                IF v_constraint = 'uq_active_slot_ticket' OR v_errmsg LIKE '%uq_active_slot_ticket%' THEN
                    v_caught_expected_rejection := TRUE;
                    RAISE NOTICE 'SUCCESS: Double allocation correctly rejected by index uq_active_slot_ticket (SQLSTATE %)', v_sqlstate;
                ELSE
                    RAISE EXCEPTION 'UNEXPECTED UNIQUE VIOLATION during allocation: % (constraint: %)', v_errmsg, v_constraint;
                END IF;
        END;

        IF v_second_insert_succeeded THEN
            RAISE EXCEPTION 'CRITICAL FAILURE: Double allocation on slot % was unexpectedly accepted!', v_test_slot;
        END IF;

        IF NOT v_caught_expected_rejection THEN
            RAISE EXCEPTION 'CRITICAL FAILURE: Double allocation on slot % was not rejected by expected trigger or unique constraint!', v_test_slot;
        END IF;

    EXCEPTION WHEN OTHERS THEN
        -- Cleanup on unexpected error
        DELETE FROM tickets WHERE ticket_id IN (v_ticket_1, v_ticket_2) OR slot_id = v_test_slot;
        DELETE FROM parking_slots WHERE slot_id = v_test_slot;
        DELETE FROM vehicles WHERE vehicle_no IN ('TEST-DBL-1', 'TEST-DBL-2');
        DELETE FROM owners WHERE owner_id = v_test_owner;
        DELETE FROM valet_staff WHERE staff_id = v_test_staff;
        RAISE;
    END;

    -- Normal cleanup
    DELETE FROM tickets WHERE ticket_id = v_ticket_1 OR slot_id = v_test_slot;
    DELETE FROM parking_slots WHERE slot_id = v_test_slot;
    DELETE FROM vehicles WHERE vehicle_no IN ('TEST-DBL-1', 'TEST-DBL-2');
    DELETE FROM owners WHERE owner_id = v_test_owner;
    DELETE FROM valet_staff WHERE staff_id = v_test_staff;
END $$;

-- Attempting to book the same vehicle concurrently on two different slots (Must fail uq_active_vehicle_ticket)
DO $$
DECLARE
    v_test_owner INT;
    v_test_staff INT;
    v_test_slot_1 INT;
    v_test_slot_2 INT;
    v_ticket_1 INT;
    v_ticket_2 INT;
    v_second_insert_succeeded BOOLEAN := FALSE;
    v_caught_expected_rejection BOOLEAN := FALSE;
    v_sqlstate TEXT;
    v_constraint TEXT;
    v_errmsg TEXT;
BEGIN
    INSERT INTO parking_slots (slot_type_id, status) VALUES (1, 'Available') RETURNING slot_id INTO v_test_slot_1;
    INSERT INTO parking_slots (slot_type_id, status) VALUES (1, 'Available') RETURNING slot_id INTO v_test_slot_2;
    INSERT INTO owners (name, phone, email) VALUES ('VehicleDupAudit', '9991113334', 'vehicle_dup_audit@test.internal') RETURNING owner_id INTO v_test_owner;
    INSERT INTO vehicles (vehicle_no, type, color, owner_id) VALUES ('TEST-DUP-VEH', 'Sedan', 'Blue', v_test_owner);
    INSERT INTO valet_staff (name, phone, shift_timing) VALUES ('StaffTest2', '9991118888', 'Evening') RETURNING staff_id INTO v_test_staff;

    BEGIN
        INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time)
        VALUES ('TEST-DUP-VEH', v_test_slot_1, v_test_staff, NOW())
        RETURNING ticket_id INTO v_ticket_1;

        BEGIN
            INSERT INTO tickets (vehicle_no, slot_id, staff_id, entry_time)
            VALUES ('TEST-DUP-VEH', v_test_slot_2, v_test_staff, NOW())
            RETURNING ticket_id INTO v_ticket_2;
            v_second_insert_succeeded := TRUE;
        EXCEPTION 
            WHEN unique_violation THEN
                GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME, v_errmsg = MESSAGE_TEXT;
                IF v_constraint = 'uq_active_vehicle_ticket' OR v_errmsg LIKE '%uq_active_vehicle_ticket%' THEN
                    v_caught_expected_rejection := TRUE;
                    RAISE NOTICE 'SUCCESS: Duplicate vehicle active ticket correctly rejected by uq_active_vehicle_ticket (SQLSTATE %)', v_sqlstate;
                ELSE
                    RAISE EXCEPTION 'UNEXPECTED UNIQUE VIOLATION: % (constraint: %)', v_errmsg, v_constraint;
                END IF;
        END;

        IF v_second_insert_succeeded THEN
            RAISE EXCEPTION 'CRITICAL FAILURE: Vehicle was double-booked across slot % and slot %!', v_test_slot_1, v_test_slot_2;
        END IF;

        IF NOT v_caught_expected_rejection THEN
            RAISE EXCEPTION 'CRITICAL FAILURE: Duplicate vehicle was not rejected by uq_active_vehicle_ticket!';
        END IF;

    EXCEPTION WHEN OTHERS THEN
        DELETE FROM tickets WHERE ticket_id IN (v_ticket_1, v_ticket_2) OR slot_id IN (v_test_slot_1, v_test_slot_2);
        DELETE FROM parking_slots WHERE slot_id IN (v_test_slot_1, v_test_slot_2);
        DELETE FROM vehicles WHERE vehicle_no = 'TEST-DUP-VEH';
        DELETE FROM owners WHERE owner_id = v_test_owner;
        DELETE FROM valet_staff WHERE staff_id = v_test_staff;
        RAISE;
    END;

    DELETE FROM tickets WHERE ticket_id = v_ticket_1 OR slot_id IN (v_test_slot_1, v_test_slot_2);
    DELETE FROM parking_slots WHERE slot_id IN (v_test_slot_1, v_test_slot_2);
    DELETE FROM vehicles WHERE vehicle_no = 'TEST-DUP-VEH';
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
