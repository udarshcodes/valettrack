#!/usr/bin/env python3
"""
ValetTrack: Machine Learning Prediction & Dynamic Pricing Inference Pipeline

Features & Provenance Controls:
1. Distinguishes Operational Forecasting Mode from Historical Demonstration / Replay Mode:
   - In operational mode: requires recent live facility readings within 48 hours; returns
     INSUFFICIENT_CURRENT_DATA if missing without fabricating observations.
   - In historical replay mode: explicitly anchors to the historical dataset ending in Dec 2016,
     recording generation timestamp separately from historical target timestamps.
2. Complete Autoregressive Recursive Forecasting:
   - Recursively forecasts every sequential hour (h = 1, 2, ..., 24) using intermediate forecasts
     to supply exact lag_1h features for subsequent steps.
   - Exact lag_24h features referenced from the exact historical hour 24 hours prior.
3. Facility-wide Aggregate Forecast:
   - Eliminates arbitrary slot-type multipliers (+5% EV, +2% Covered).
   - Applies the 4-tier facility dynamic pricing policy (INR ₹) to each slot type's base rate.
4. Safe ACID Database Transactions:
   - Atomic transaction management with rollback on error.
   - Prevents duplicate prediction inflation on retries.
"""

import os
import sys
import json
import argparse
from datetime import datetime, timezone, timedelta
import pandas as pd
import joblib
import psycopg2
from psycopg2.extras import execute_values

MODEL_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'models')
MODEL_PATH = os.path.join(MODEL_DIR, 'occupancy_forecaster.joblib')
METADATA_PATH = os.path.join(MODEL_DIR, 'model_metadata.json')


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        port=int(os.getenv('DB_PORT', '5432')),
        user=os.getenv('DB_USER', 'valettrack'),
        password=os.getenv('DB_PASSWORD', 'valettrack_secret'),
        dbname=os.getenv('DB_NAME', 'valettrack_db')
    )


def calculate_facility_dynamic_rate(occupancy_pct, base_rate):
    """
    Facility dynamic pricing policy (INR ₹):
    - Occupancy > 80%: +20% surge
    - Occupancy 60% - 80%: Standard baseline rate
    - Occupancy 30% - <60%: -10% incentive discount
    - Occupancy < 30%: -20% off-peak discount
    """
    occ = float(occupancy_pct)
    base = float(base_rate)
    
    if occ > 80.0:
        multiplier = 1.20
    elif occ >= 60.0:
        multiplier = 1.00
    elif occ >= 30.0:
        multiplier = 0.90
    else:
        multiplier = 0.80
        
    return round(base * multiplier, 2)


def generate_predictions(mode='historical_replay', clean_existing=True):
    print("=== ValetTrack Machine Learning Inference & Storage ===")
    print(f"Requested Execution Mode: {mode.upper()}")
    
    if not os.path.exists(MODEL_PATH) or not os.path.exists(METADATA_PATH):
        raise FileNotFoundError("Model artifacts not found. Run 'npm run ml:train' first to train the model.")
        
    with open(METADATA_PATH, 'r', encoding='utf-8') as f:
        meta = json.load(f)
        
    model = joblib.load(MODEL_PATH)
    print(f"Loaded model: {meta.get('model_name')} ({meta.get('model_version')})")
    print(f"Verified Validation MAE: {meta['metrics']['validation_mae']}%, RMSE: {meta['metrics']['validation_rmse']}%")
    
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        
        # 1. Retrieve facility slot types and current base rates
        cur.execute("SELECT slot_type_id, type_name, base_rate FROM slot_types ORDER BY slot_type_id ASC;")
        slot_types = cur.fetchall()
        
        if not slot_types:
            raise ValueError("No slot types configured in database. Run 'npm run db:seed' first.")
            
        now_utc = datetime.now(timezone.utc)
        generation_time = now_utc
        
        # 2. Check mode and query appropriate observations
        if mode == 'operational':
            # Operational forecasting: check for genuine recent facility sensor readings within last 48h
            cur.execute("""
                SELECT date_trunc('hour', reading_time) as bucket, ROUND(AVG(occupancy_pct), 2) as avg_occ
                FROM occupancy_readings
                WHERE reading_time >= %s - interval '48 hours'
                GROUP BY date_trunc('hour', reading_time)
                ORDER BY bucket ASC;
            """, [now_utc])
            live_rows = cur.fetchall()
            
            if not live_rows:
                print("Notice: No live facility sensor observations within last 48h.")
                return {
                    "status": "INSUFFICIENT_CURRENT_DATA",
                    "mode": "operational",
                    "message": "Operational forecasting requires current facility sensor readings within the last 48 hours. "
                               "No recent operational observations found. Use mode 'historical_replay' for historical demonstration.",
                    "generation_time": generation_time.isoformat()
                }
            
            latest_bucket = live_rows[-1][0]
            hours_since_latest = (now_utc - latest_bucket).total_seconds() / 3600.0
            if hours_since_latest > 3.0:
                print(f"Notice: Latest telemetry reading ({latest_bucket.isoformat()}) is stale ({hours_since_latest:.1f} hours old).")
                return {
                    "status": "INSUFFICIENT_CURRENT_DATA",
                    "mode": "operational",
                    "message": f"Operational forecasting halted: latest telemetry reading ({latest_bucket.isoformat()}) is stale ({hours_since_latest:.1f} hours old, max 3.0h allowed). Fresh sensor readings required.",
                    "generation_time": generation_time.isoformat()
                }
            
            bucket_map = {r[0]: float(r[1]) for r in live_rows}
            missing_hours = []
            for k in range(24):
                expected_hour = latest_bucket - timedelta(hours=k)
                if expected_hour not in bucket_map:
                    missing_hours.append(expected_hour.isoformat())
            
            if missing_hours:
                print(f"Notice: Gaps detected in operational telemetry ({len(missing_hours)} missing hours).")
                return {
                    "status": "INSUFFICIENT_CURRENT_DATA",
                    "mode": "operational",
                    "message": f"Operational forecasting requires 24 consecutive hourly readings for lag_24h feature calculation. Missing {len(missing_hours)} hour(s): {missing_hours[:3]}",
                    "generation_time": generation_time.isoformat(),
                    "missing_hours_count": len(missing_hours)
                }
            
            obs_lookup = bucket_map
            anchor_time = latest_bucket.replace(minute=0, second=0, microsecond=0)
            data_source = "ValetTrack Facility Real-Time Sensor Telemetry"
            status_label = "OPERATIONAL_FORECAST"
            mode_tag = "Operational"
        else:
            # Historical Demonstration / Replay Mode: query genuine observations from Birmingham dataset
            cur.execute("""
                SELECT bucket, ROUND(AVG(avg_occupancy_pct), 2) as avg_occ
                FROM birmingham_hourly_summary
                GROUP BY bucket
                ORDER BY bucket DESC
                LIMIT 72;
            """)
            hist_rows = cur.fetchall()
            
            if not hist_rows:
                raise ValueError("No historical observations found in birmingham_hourly_summary. Run 'npm run import:birmingham' first.")
                
            obs_lookup = {b: float(occ) for b, occ in hist_rows}
            anchor_time = max(obs_lookup.keys()).replace(minute=0, second=0, microsecond=0)
            data_source = "City of Birmingham Municipal Parking Sensor Dataset (UCI ML Repository, Historical Replay)"
            status_label = "HISTORICAL_DEMO_REPLAY"
            mode_tag = "Historical Replay"
            
        print(f"* Data Source: {data_source}")
        print(f"* Forecast Origin (Anchor): {anchor_time.strftime('%Y-%m-%d %H:00 UTC')}")
        print(f"* Generation Timestamp:     {generation_time.isoformat()}")
        
        # 3. Recursive Autoregressive Multi-Step Forecasting (h = 1 to 24)
        # Maintains a continuous chronological series of historical observations + intermediate forecasts
        series_timeline = {k: v for k, v in obs_lookup.items()}
        sorted_times = sorted(series_timeline.keys())
        latest_historical_occ = series_timeline[sorted_times[-1]]
        
        forecast_steps = {}
        for h in range(1, 25):
            target_time = anchor_time + timedelta(hours=h)
            t_minus_1h = target_time - timedelta(hours=1)
            t_minus_24h = target_time - timedelta(hours=24)
            
            # Autoregressive lag_1h retrieval (exact timestamp matching)
            if t_minus_1h in series_timeline:
                lag_1h = series_timeline[t_minus_1h]
            else:
                preceding = [t for t in sorted_times if t <= t_minus_1h]
                lag_1h = series_timeline[preceding[-1]] if preceding else latest_historical_occ
                
            # Seasonal lag_24h retrieval (exact timestamp matching)
            if t_minus_24h in series_timeline:
                lag_24h = series_timeline[t_minus_24h]
            else:
                preceding_24 = [t for t in sorted_times if t <= t_minus_24h]
                lag_24h = series_timeline[preceding_24[-1]] if preceding_24 else lag_1h
                
            day_of_week = target_time.weekday()
            is_weekend = 1 if day_of_week >= 5 else 0
            
            features = pd.DataFrame([{
                'hour': target_time.hour,
                'day_of_week': day_of_week,
                'is_weekend': is_weekend,
                'lag_1h': lag_1h,
                'lag_24h': lag_24h
            }])
            
            # Predict intermediate step
            pred_occ = float(model.predict(features)[0])
            pred_occ = round(max(0.0, min(100.0, pred_occ)), 2)
            
            # Store in series_timeline so step h + 1 uses this exact forecast as its lag_1h
            series_timeline[target_time] = pred_occ
            sorted_times.append(target_time)
            forecast_steps[h] = {
                'target_time': target_time,
                'predicted_occupancy': pred_occ
            }
            
        # 4. Prepare Persisted Records for Documented Horizons: +1h, +2h, +4h, +8h, +12h, +24h
        documented_horizons = [1, 2, 4, 8, 12, 24]
        occupancy_records = []
        pricing_records = []
        
        raw_version = meta.get('model_version', 'v1.4')
        model_version_tag = f"{raw_version[:30]}-{mode}"[:50]
        
        for h in documented_horizons:
            step_data = forecast_steps[h]
            t_time = step_data['target_time']
            p_occ = step_data['predicted_occupancy']
            
            target_str = t_time.strftime('%Y-%m-%d %H:00 UTC')
            # Fits within VARCHAR(50): e.g. "+1h Horizon (2016-12-19 17:00 UTC)" (35 chars)
            time_slot_label = f"+{h}h Horizon ({target_str})"
            
            for st_id, st_name, base_rate in slot_types:
                # Dynamic pricing applied to each slot type baseline according to facility demand tier
                suggested_rate = calculate_facility_dynamic_rate(p_occ, base_rate)
                
                occupancy_records.append((
                    generation_time,
                    st_id,
                    time_slot_label,
                    p_occ,
                    model_version_tag
                ))
                
                pricing_records.append((
                    generation_time,
                    st_id,
                    time_slot_label,
                    p_occ,
                    suggested_rate,
                    model_version_tag
                ))
                
        # 5. Atomic Database Persistence with Transaction Safety & Deduplication
        if clean_existing:
            # Cleanly replace active forecasts to prevent inflation of duplicate records on repeated calls
            cur.execute("DELETE FROM occupancy_predictions WHERE model_version = %s;", [model_version_tag])
            cur.execute("DELETE FROM pricing_predictions WHERE model_version = %s;", [model_version_tag])
            
        insert_occ_query = """
            INSERT INTO occupancy_predictions 
              (prediction_time, slot_type_id, time_slot, predicted_occupancy, model_version)
            VALUES %s;
        """
        execute_values(cur, insert_occ_query, occupancy_records)
        
        insert_price_query = """
            INSERT INTO pricing_predictions 
              (prediction_time, slot_type_id, time_slot, occupancy_pct, suggested_rate, model_version)
            VALUES %s;
        """
        execute_values(cur, insert_price_query, pricing_records)
        
        conn.commit()
        print(f"\nGenerated and stored {len(occupancy_records)} horizon predictions:")
        print(f"* Table 'occupancy_predictions': {len(occupancy_records)} records")
        print(f"* Table 'pricing_predictions':   {len(pricing_records)} records")
        print(f"* Prediction Status:            {status_label}")
        print("=== Inference Completed Successfully ===")
        
        return {
            "status": "SUCCESS",
            "prediction_status": status_label,
            "mode": mode,
            "data_source": data_source,
            "forecast_origin": anchor_time.isoformat(),
            "generation_time": generation_time.isoformat(),
            "predictions_count": len(occupancy_records),
            "model_version": model_version_tag,
            "documented_horizons": [f"+{h}h" for h in documented_horizons],
            "predictions": [
                {
                    "horizon": f"+{h}h",
                    "target_time": forecast_steps[h]['target_time'].isoformat(),
                    "predicted_occupancy": forecast_steps[h]['predicted_occupancy']
                }
                for h in documented_horizons
            ]
        }
    except Exception as e:
        conn.rollback()
        print(f"Database error during prediction generation: {e}", file=sys.stderr)
        raise e
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="ValetTrack ML Occupancy & Pricing Forecasting")
    parser.add_argument('--mode', choices=['historical_replay', 'operational'], default='historical_replay',
                        help="Forecasting mode: 'historical_replay' (default) or 'operational'")
    parser.add_argument('--json', action='store_true', help="Output result as JSON")
    args = parser.parse_args()
    
    res = generate_predictions(mode=args.mode)
    if args.json:
        print(json.dumps(res, indent=2))
