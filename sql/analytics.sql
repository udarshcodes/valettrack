-- ==============================================================================
-- ValetTrack: TimescaleDB Time-Series Analytics & Business Queries
-- ==============================================================================

-- 1. Facility Hourly Occupancy Time-Bucket Analysis
-- Groups 15-minute sensor readings into 1-hour buckets using time_bucket()
SELECT 
    time_bucket('1 hour', reading_time) AS hour_bucket,
    st.type_name,
    ROUND(AVG(r.occupancy_pct), 2) AS avg_occupancy_pct,
    ROUND(MAX(r.occupancy_pct), 2) AS peak_occupancy_pct,
    COUNT(*) AS reading_count
FROM occupancy_readings r
JOIN slot_types st ON r.slot_type_id = st.slot_type_id
GROUP BY hour_bucket, st.type_name
ORDER BY hour_bucket DESC, st.type_name
LIMIT 20;

-- 2. Daily Summary Aggregations using time_bucket()
SELECT 
    time_bucket('1 day', reading_time) AS day_bucket,
    st.type_name,
    ROUND(AVG(r.occupancy_pct), 2) AS daily_avg_occupancy,
    ROUND(MAX(r.occupancy_pct), 2) AS daily_peak_occupancy,
    ROUND(MIN(r.occupancy_pct), 2) AS daily_low_occupancy
FROM occupancy_readings r
JOIN slot_types st ON r.slot_type_id = st.slot_type_id
GROUP BY day_bucket, st.type_name
ORDER BY day_bucket DESC, st.type_name;

-- 3. Querying Continuous Aggregate: hourly_occupancy_summary
-- High performance pre-materialized rollup maintained incrementally by TimescaleDB
SELECT 
    bucket,
    st.type_name,
    avg_occupancy_pct,
    peak_occupancy_pct,
    min_occupancy_pct,
    sample_count
FROM hourly_occupancy_summary s
JOIN slot_types st ON s.slot_type_id = st.slot_type_id
ORDER BY bucket DESC
LIMIT 15;

-- 4. Dynamic Pricing Analysis: Suggested Rate vs Base Rate
SELECT 
    pp.prediction_time,
    pp.time_slot,
    st.type_name,
    st.base_rate,
    pp.occupancy_pct AS predicted_occupancy,
    pp.suggested_rate,
    ROUND(((pp.suggested_rate - st.base_rate) / st.base_rate) * 100, 1) AS surge_pct
FROM pricing_predictions pp
JOIN slot_types st ON pp.slot_type_id = st.slot_type_id
ORDER BY pp.prediction_time DESC, pp.time_slot;

-- 5. Birmingham Sensor Dataset: Peak Demand Car Parks via Continuous Aggregate
SELECT 
    system_code_number,
    ROUND(AVG(avg_occupancy_pct), 2) AS overall_avg_pct,
    MAX(peak_occupancy_pct) AS historical_peak_pct,
    MAX(capacity) AS car_park_capacity,
    COUNT(*) AS hours_monitored
FROM birmingham_hourly_summary
GROUP BY system_code_number
ORDER BY overall_avg_pct DESC
LIMIT 10;

-- 6. SFpark Street Sensor Dataset: District Demand & Meter Pricing Analysis
SELECT 
    district_name,
    time_bucket('1 day', start_time) AS observation_day,
    ROUND(AVG(occupancy_pct), 2) AS avg_district_occupancy,
    ROUND(AVG(rate), 2) AS avg_meter_rate,
    COUNT(*) AS total_block_readings
FROM sfpark_readings
GROUP BY district_name, observation_day
ORDER BY observation_day DESC, avg_district_occupancy DESC
LIMIT 15;

-- 7. Revenue & Ticket Operations Summary
SELECT 
    st.type_name,
    COUNT(t.ticket_id) AS total_tickets,
    COUNT(CASE WHEN t.exit_time IS NULL THEN 1 END) AS active_tickets,
    COUNT(CASE WHEN t.exit_time IS NOT NULL THEN 1 END) AS completed_tickets,
    ROUND(COALESCE(SUM(t.amount_paid), 0), 2) AS total_revenue,
    ROUND(COALESCE(AVG(CASE WHEN t.exit_time IS NOT NULL THEN t.amount_paid END), 0), 2) AS avg_ticket_revenue
FROM slot_types st
JOIN parking_slots ps ON st.slot_type_id = ps.slot_type_id
LEFT JOIN tickets t ON ps.slot_id = t.slot_id
GROUP BY st.type_name;
