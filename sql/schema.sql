-- ==============================================================================
-- ValetTrack: PostgreSQL & TimescaleDB Database Schema
-- Normalized relational core (BCNF) + High-performance Time-series Hypertables
-- ==============================================================================

-- Enable TimescaleDB Extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ------------------------------------------------------------------------------
-- SECTION 1: RELATIONAL ENTITIES (BCNF)
-- ------------------------------------------------------------------------------

-- 1.1 Owners
CREATE TABLE IF NOT EXISTS owners (
    owner_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1.2 Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
    vehicle_no VARCHAR(20) PRIMARY KEY,
    type VARCHAR(30) NOT NULL,
    color VARCHAR(30) NOT NULL,
    owner_id INT NOT NULL REFERENCES owners(owner_id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1.3 Valet Staff
CREATE TABLE IF NOT EXISTS valet_staff (
    staff_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    shift_timing VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 1.4 Slot Types
CREATE TABLE IF NOT EXISTS slot_types (
    slot_type_id SERIAL PRIMARY KEY,
    type_name VARCHAR(30) NOT NULL UNIQUE,
    base_rate NUMERIC(8,2) NOT NULL,
    CONSTRAINT chk_slottype_name CHECK (type_name IN ('Regular', 'Covered', 'EVCharging')),
    CONSTRAINT chk_slottype_rate CHECK (base_rate >= 0)
);

-- 1.5 Parking Slots
CREATE TABLE IF NOT EXISTS parking_slots (
    slot_id SERIAL PRIMARY KEY,
    slot_type_id INT NOT NULL REFERENCES slot_types(slot_type_id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'Available',
    CONSTRAINT chk_slot_status CHECK (status IN ('Available', 'Occupied', 'Reserved'))
);

-- 1.6 Tickets
CREATE TABLE IF NOT EXISTS tickets (
    ticket_id SERIAL PRIMARY KEY,
    vehicle_no VARCHAR(20) NOT NULL REFERENCES vehicles(vehicle_no) ON DELETE RESTRICT,
    slot_id INT NOT NULL REFERENCES parking_slots(slot_id) ON DELETE RESTRICT,
    staff_id INT NOT NULL REFERENCES valet_staff(staff_id) ON DELETE RESTRICT,
    entry_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    exit_time TIMESTAMPTZ,
    amount_paid NUMERIC(8,2) NOT NULL DEFAULT 0.00,
    CONSTRAINT chk_ticket_amount CHECK (amount_paid >= 0),
    CONSTRAINT chk_ticket_time CHECK (exit_time IS NULL OR exit_time >= entry_time)
);

-- Unique index to prevent two active tickets on the same parking slot concurrently
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_slot_ticket 
ON tickets(slot_id) 
WHERE exit_time IS NULL;

-- Unique index to prevent a vehicle from having multiple active tickets concurrently
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_vehicle_ticket 
ON tickets(vehicle_no) 
WHERE exit_time IS NULL;

-- ------------------------------------------------------------------------------
-- SECTION 2: BUSINESS LOGIC FUNCTIONS & TRIGGERS
-- ------------------------------------------------------------------------------

-- 2.1 Calculate stay amount: whole billable hours (rounded up) * BaseRate (minimum 1 hour)
CREATE OR REPLACE FUNCTION fn_calculate_amount(
    p_slot_id INT,
    p_entry TIMESTAMPTZ,
    p_exit TIMESTAMPTZ
) RETURNS NUMERIC(8,2) AS $$
DECLARE
    v_base_rate NUMERIC(8,2);
    v_seconds NUMERIC;
    v_hours NUMERIC;
BEGIN
    SELECT st.base_rate INTO v_base_rate
    FROM parking_slots ps
    JOIN slot_types st ON ps.slot_type_id = st.slot_type_id
    WHERE ps.slot_id = p_slot_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parking slot % not found.', p_slot_id;
    END IF;

    v_seconds := EXTRACT(EPOCH FROM (p_exit - p_entry));
    v_hours := CEIL(v_seconds / 3600.0);
    IF v_hours < 1 THEN
        v_hours := 1;
    END IF;

    RETURN v_hours * v_base_rate;
END;
$$ LANGUAGE plpgsql;

-- 2.2 Trigger: Before opening ticket, ensure slot is 'Available'
CREATE OR REPLACE FUNCTION trg_fn_ticket_before_insert() 
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR(20);
BEGIN
    IF NEW.exit_time IS NULL THEN
        SELECT status INTO v_status FROM parking_slots WHERE slot_id = NEW.slot_id;
        IF v_status <> 'Available' THEN
            RAISE EXCEPTION 'Selected slot % is not available for allocation (status: %).', NEW.slot_id, v_status;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_before_insert ON tickets;
CREATE TRIGGER trg_ticket_before_insert
BEFORE INSERT ON tickets
FOR EACH ROW
EXECUTE FUNCTION trg_fn_ticket_before_insert();

-- 2.3 Trigger: After opening ticket, mark slot as 'Occupied' if active
CREATE OR REPLACE FUNCTION trg_fn_ticket_after_insert() 
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.exit_time IS NULL THEN
        UPDATE parking_slots SET status = 'Occupied' WHERE slot_id = NEW.slot_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_after_insert ON tickets;
CREATE TRIGGER trg_ticket_after_insert
AFTER INSERT ON tickets
FOR EACH ROW
EXECUTE FUNCTION trg_fn_ticket_after_insert();

-- 2.4 Trigger: After closing ticket (exit_time updated), mark slot as 'Available'
CREATE OR REPLACE FUNCTION trg_fn_ticket_after_update() 
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.exit_time IS NOT NULL AND OLD.exit_time IS NULL THEN
        UPDATE parking_slots SET status = 'Available' WHERE slot_id = NEW.slot_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_after_update ON tickets;
CREATE TRIGGER trg_ticket_after_update
AFTER UPDATE OF exit_time ON tickets
FOR EACH ROW
EXECUTE FUNCTION trg_fn_ticket_after_update();

-- ------------------------------------------------------------------------------
-- SECTION 3: TIMESCALEDB TIME-SERIES HYPERTABLES
-- ------------------------------------------------------------------------------

-- 3.1 Facility Historical Occupancy Readings
CREATE TABLE IF NOT EXISTS occupancy_readings (
    reading_id BIGSERIAL,
    reading_time TIMESTAMPTZ NOT NULL,
    slot_type_id INT NOT NULL REFERENCES slot_types(slot_type_id),
    total_slots INT NOT NULL CHECK (total_slots > 0),
    occupied_slots INT NOT NULL CHECK (occupied_slots >= 0),
    occupancy_pct NUMERIC(5,2) NOT NULL CHECK (occupancy_pct >= 0 AND occupancy_pct <= 100),
    source VARCHAR(50) DEFAULT 'valet_sensor_feed',
    PRIMARY KEY (reading_id, reading_time)
);
SELECT create_hypertable('occupancy_readings', 'reading_time', if_not_exists => TRUE);

-- 3.2 Occupancy Predictions
CREATE TABLE IF NOT EXISTS occupancy_predictions (
    prediction_id BIGSERIAL,
    prediction_time TIMESTAMPTZ NOT NULL,
    slot_type_id INT NOT NULL REFERENCES slot_types(slot_type_id),
    time_slot VARCHAR(50) NOT NULL,
    predicted_occupancy NUMERIC(5,2) NOT NULL CHECK (predicted_occupancy >= 0 AND predicted_occupancy <= 100),
    model_version VARCHAR(50) DEFAULT 'v1-arima-lstm',
    PRIMARY KEY (prediction_id, prediction_time)
);
SELECT create_hypertable('occupancy_predictions', 'prediction_time', if_not_exists => TRUE);

-- 3.3 Pricing Predictions
CREATE TABLE IF NOT EXISTS pricing_predictions (
    pricing_id BIGSERIAL,
    prediction_time TIMESTAMPTZ NOT NULL,
    slot_type_id INT NOT NULL REFERENCES slot_types(slot_type_id),
    time_slot VARCHAR(50) NOT NULL,
    occupancy_pct NUMERIC(5,2) NOT NULL CHECK (occupancy_pct >= 0 AND occupancy_pct <= 100),
    suggested_rate NUMERIC(8,2) NOT NULL CHECK (suggested_rate >= 0),
    model_version VARCHAR(50) DEFAULT 'v1-dynamic-surge',
    PRIMARY KEY (pricing_id, prediction_time)
);
SELECT create_hypertable('pricing_predictions', 'prediction_time', if_not_exists => TRUE);

-- 3.4 Birmingham Parking Dataset Hypertable (UCI Machine Learning Repository)
CREATE TABLE IF NOT EXISTS birmingham_readings (
    reading_id BIGSERIAL,
    reading_time TIMESTAMPTZ NOT NULL,
    system_code_number VARCHAR(50) NOT NULL,
    capacity INT NOT NULL CHECK (capacity >= 0),
    occupancy INT NOT NULL CHECK (occupancy >= 0),
    occupancy_pct NUMERIC(5,2) NOT NULL CHECK (occupancy_pct >= 0 AND occupancy_pct <= 100),
    PRIMARY KEY (reading_id, reading_time)
);
SELECT create_hypertable('birmingham_readings', 'reading_time', if_not_exists => TRUE);

-- 3.5 SFpark Parking Sensor Dataset Hypertable (Hourly Occupancy & Dynamic Rate)
CREATE TABLE IF NOT EXISTS sfpark_readings (
    reading_id BIGSERIAL,
    start_time TIMESTAMPTZ NOT NULL,
    block_id VARCHAR(50) NOT NULL,
    street_name VARCHAR(100),
    block_num VARCHAR(20),
    street_block VARCHAR(100),
    area_type VARCHAR(50),
    district_name VARCHAR(50) NOT NULL,
    rate NUMERIC(6,2),
    total_time INT,
    total_occupied_time INT,
    total_vacant_time INT,
    occupancy_pct NUMERIC(5,2) NOT NULL CHECK (occupancy_pct >= 0 AND occupancy_pct <= 100),
    day_type VARCHAR(20),
    time_of_day VARCHAR(10),
    PRIMARY KEY (reading_id, start_time)
);
SELECT create_hypertable('sfpark_readings', 'start_time', if_not_exists => TRUE);

-- 1.7 Dataset Import Manifest Audit Log
CREATE TABLE IF NOT EXISTS dataset_imports (
    import_id SERIAL PRIMARY KEY,
    dataset_name VARCHAR(50) NOT NULL,
    source_filename VARCHAR(255) NOT NULL,
    source_checksum VARCHAR(64),
    import_start TIMESTAMPTZ NOT NULL,
    import_completed TIMESTAMPTZ,
    source_rows_processed BIGINT NOT NULL DEFAULT 0,
    rows_imported BIGINT NOT NULL DEFAULT 0,
    duplicates_ignored BIGINT NOT NULL DEFAULT 0,
    rejected_rows BIGINT NOT NULL DEFAULT 0,
    cleaned_rows BIGINT NOT NULL DEFAULT 0,
    earliest_timestamp TIMESTAMPTZ,
    latest_timestamp TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_dataset_imports_name ON dataset_imports(dataset_name, import_start DESC);

-- ------------------------------------------------------------------------------
-- SECTION 4: TIMESCALEDB CONTINUOUS AGGREGATES
-- ------------------------------------------------------------------------------

-- 4.1 Hourly Continuous Aggregate on Facility Occupancy
CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_occupancy_summary
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', reading_time) AS bucket,
    slot_type_id,
    ROUND(AVG(occupancy_pct), 2) AS avg_occupancy_pct,
    ROUND(MAX(occupancy_pct), 2) AS peak_occupancy_pct,
    ROUND(MIN(occupancy_pct), 2) AS min_occupancy_pct,
    COUNT(*) AS sample_count
FROM occupancy_readings
GROUP BY bucket, slot_type_id
WITH NO DATA;

-- 4.2 Hourly Continuous Aggregate on Birmingham Real Car Parks
CREATE MATERIALIZED VIEW IF NOT EXISTS birmingham_hourly_summary
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', reading_time) AS bucket,
    system_code_number,
    ROUND(AVG(occupancy_pct), 2) AS avg_occupancy_pct,
    ROUND(MAX(occupancy_pct), 2) AS peak_occupancy_pct,
    ROUND(AVG(occupancy)::numeric, 0) AS avg_occupancy,
    MAX(capacity) AS capacity,
    COUNT(*) AS sample_count
FROM birmingham_readings
GROUP BY bucket, system_code_number
WITH NO DATA;

-- 4.3 Hourly Continuous Aggregate on SFpark Real Street Sensor Data
CREATE MATERIALIZED VIEW IF NOT EXISTS sfpark_hourly_summary
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', start_time) AS bucket,
    district_name,
    ROUND(AVG(occupancy_pct), 2) AS avg_occupancy_pct,
    ROUND(MAX(occupancy_pct), 2) AS peak_occupancy_pct,
    ROUND(AVG(rate), 2) AS avg_meter_rate,
    COUNT(*) AS sample_count
FROM sfpark_readings
GROUP BY bucket, district_name
WITH NO DATA;

-- ------------------------------------------------------------------------------
-- SECTION 5: PERFORMANCE INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_parking_slots_status ON parking_slots(status);
CREATE INDEX IF NOT EXISTS idx_parking_slots_type ON parking_slots(slot_type_id);
CREATE INDEX IF NOT EXISTS idx_tickets_vehicle ON tickets(vehicle_no);
CREATE INDEX IF NOT EXISTS idx_tickets_slot ON tickets(slot_id);
CREATE INDEX IF NOT EXISTS idx_tickets_staff ON tickets(staff_id);
CREATE INDEX IF NOT EXISTS idx_tickets_entry ON tickets(entry_time DESC);
CREATE INDEX IF NOT EXISTS idx_birmingham_code_time ON birmingham_readings(system_code_number, reading_time DESC);
CREATE INDEX IF NOT EXISTS idx_sfpark_district_time ON sfpark_readings(district_name, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sfpark_start_time ON sfpark_readings(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_sfpark_block_time ON sfpark_readings(block_id, start_time DESC);

-- ------------------------------------------------------------------------------
-- SECTION 6: SEQUENCE SYNCHRONIZATION UTILITY
-- ------------------------------------------------------------------------------
-- Synchronizes all public primary key sequences with the actual maximum column values.
-- Safe on empty tables (resets sequence to 1 with is_called = false).
CREATE OR REPLACE FUNCTION fn_sync_all_sequences()
RETURNS TABLE(table_name text, column_name text, sequence_name text, max_id bigint, is_called boolean) AS $$
DECLARE
    r RECORD;
    v_max_id BIGINT;
    v_sql TEXT;
BEGIN
    FOR r IN (
        SELECT 
            tc.table_name::text, 
            ccu.column_name::text, 
            pg_get_serial_sequence('public.' || quote_ident(tc.table_name), ccu.column_name)::text AS seq_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu 
          ON tc.constraint_name = ccu.constraint_name 
         AND tc.table_schema = ccu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' 
          AND tc.table_schema = 'public'
          AND pg_get_serial_sequence('public.' || quote_ident(tc.table_name), ccu.column_name) IS NOT NULL
    ) LOOP
        v_sql := format('SELECT MAX(%I) FROM public.%I', r.column_name, r.table_name);
        EXECUTE v_sql INTO v_max_id;
        
        IF v_max_id IS NOT NULL THEN
            PERFORM setval(r.seq_name, v_max_id, true);
            table_name := r.table_name;
            column_name := r.column_name;
            sequence_name := r.seq_name;
            max_id := v_max_id;
            is_called := true;
            RETURN NEXT;
        ELSE
            PERFORM setval(r.seq_name, 1, false);
            table_name := r.table_name;
            column_name := r.column_name;
            sequence_name := r.seq_name;
            max_id := NULL;
            is_called := false;
            RETURN NEXT;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

