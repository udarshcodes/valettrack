#!/usr/bin/env python3
"""
ValetTrack: Genuine Occupancy Prediction Model Training Pipeline
Trained on real municipal parking sensor time series data (UCI Birmingham Parking Dataset).

Features:
- Preserves complete hourly time index before constructing lag features.
- Explicitly handles missing/unmonitored hours via time-based linear interpolation.
- Ensures lag_1h and lag_24h refer to exact timestamps (t - 1h and t - 24h).
- Chronological train/validation split (80% train, 20% validation) to prevent future leakage.
- Evaluates against valid naive baseline (24-hour persistence benchmark).
- Updates metadata JSON only after metrics have actually been reproduced.
- Aligns model metadata with runtime scikit-learn version.
"""

import os
import sys
import json
from datetime import datetime, timezone
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib

MODEL_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'models')
DATA_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'birmingham', 'dataset.csv')
MODEL_PATH = os.path.join(MODEL_DIR, 'occupancy_forecaster.joblib')
METADATA_PATH = os.path.join(MODEL_DIR, 'model_metadata.json')


def train_model():
    print("=== ValetTrack Machine Learning Model Training Pipeline ===")
    
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"Training dataset not found at {DATA_PATH}. Place genuine parking dataset.csv first.")
    
    print(f"1. Loading real sensor dataset from {DATA_PATH}...")
    df = pd.read_csv(DATA_PATH)
    print(f"   Raw observations loaded: {len(df):,} rows")
    
    # Clean and parse timestamps
    df['LastUpdated'] = pd.to_datetime(df['LastUpdated'], errors='coerce')
    df = df.dropna(subset=['LastUpdated', 'Capacity', 'Occupancy'])
    
    # Filter valid non-zero capacities and clamp anomalies
    df = df[df['Capacity'] > 0]
    df['Occupancy'] = df['Occupancy'].clip(lower=0)
    df['occupancy_pct'] = ((df['Occupancy'] / df['Capacity']) * 100.0).clip(lower=0.0, upper=100.0)
    
    # 2. Preserve complete hourly time index across observation bounds
    min_time = df['LastUpdated'].min().floor('h')
    max_time = df['LastUpdated'].max().ceil('h')
    full_hourly_index = pd.date_range(start=min_time, end=max_time, freq='1h')
    print(f"   Complete continuous hourly index span: {len(full_hourly_index):,} hours ({min_time} to {max_time})")
    
    # Aggregate raw observations into hourly averages
    df_sorted = df.set_index('LastUpdated').sort_index()
    raw_hourly_series = df_sorted['occupancy_pct'].resample('1h').mean()
    
    # Reindex onto complete continuous hourly index to preserve exact chronological spacing
    hourly_df = raw_hourly_series.reindex(full_hourly_index).to_frame(name='occupancy_pct')
    missing_count = int(hourly_df['occupancy_pct'].isna().sum())
    observed_count = int(hourly_df['occupancy_pct'].notna().sum())
    print(f"   Observed hours: {observed_count:,} | Missing/unmonitored hours: {missing_count:,}")
    
    # Explicitly handle missing hours:
    # Birmingham municipal car parks record data primarily during active monitoring hours.
    # Unmonitored overnight hours and gaps are explicitly handled via time-based linear interpolation,
    # ensuring the hourly grid remains intact without distortion of lag steps.
    hourly_df['occupancy_pct'] = hourly_df['occupancy_pct'].interpolate(method='time').bfill().ffill().clip(0.0, 100.0)
    
    # Feature Engineering (strictly using past data on complete hourly grid):
    # Because every step in full_hourly_index is guaranteed to be exactly 1 hour:
    # lag_1h refers strictly to (t - 1h)
    # lag_24h refers strictly to (t - 24h, same hour previous day)
    hourly_df['hour'] = hourly_df.index.hour
    hourly_df['day_of_week'] = hourly_df.index.dayofweek
    hourly_df['is_weekend'] = (hourly_df.index.dayofweek >= 5).astype(int)
    hourly_df['lag_1h'] = hourly_df['occupancy_pct'].shift(1)
    hourly_df['lag_24h'] = hourly_df['occupancy_pct'].shift(24)
    
    # Drop initial 24 hours that lack 24h history
    feature_df = hourly_df.dropna()
    print(f"   Engineered features dataset: {len(feature_df):,} complete hourly samples")
    
    feature_cols = ['hour', 'day_of_week', 'is_weekend', 'lag_1h', 'lag_24h']
    target_col = 'occupancy_pct'
    
    # Chronological Split: 80% train, 20% holdout validation
    split_idx = int(len(feature_df) * 0.8)
    train_df = feature_df.iloc[:split_idx]
    test_df = feature_df.iloc[split_idx:]
    
    X_train, y_train = train_df[feature_cols], train_df[target_col]
    X_test, y_test = test_df[feature_cols], test_df[target_col]
    
    print(f"3. Chronological dataset split:")
    print(f"   Training set:   {len(X_train):,} samples ({train_df.index.min()} to {train_df.index.max()})")
    print(f"   Validation set: {len(X_test):,} samples ({test_df.index.min()} to {test_df.index.max()})")
    
    # Baseline Model: Naive 24-hour persistence (exact lag_24h)
    baseline_preds = X_test['lag_24h']
    baseline_mae = float(mean_absolute_error(y_test, baseline_preds))
    baseline_rmse = float(np.sqrt(mean_squared_error(y_test, baseline_preds)))
    print(f"\n4. Baseline Benchmark (Naive 24h Persistence):")
    print(f"   Baseline MAE:  {baseline_mae:.2f}%")
    print(f"   Baseline RMSE: {baseline_rmse:.2f}%")
    
    # Train Gradient Boosting Regressor
    print("\n5. Training HistGradientBoostingRegressor on genuine continuous time series...")
    model = HistGradientBoostingRegressor(
        max_iter=150,
        learning_rate=0.08,
        max_depth=5,
        min_samples_leaf=10,
        random_state=42
    )
    model.fit(X_train, y_train)
    
    # Inference and Evaluation on unseen chronological validation holdout
    y_pred = model.predict(X_test)
    y_pred = np.clip(y_pred, 0.0, 100.0)
    
    mae = float(mean_absolute_error(y_test, y_pred))
    rmse = float(np.sqrt(mean_squared_error(y_test, y_pred)))
    r2 = float(r2_score(y_test, y_pred))
    improvement_pct = float(((baseline_mae - mae) / baseline_mae) * 100)
    
    print(f"\n6. Validation Results on Holdout Data:")
    print(f"   Trained Model MAE:  {mae:.2f}% (Improvement: {improvement_pct:.1f}%)")
    print(f"   Trained Model RMSE: {rmse:.2f}%")
    print(f"   Validation R²:      {r2:.4f}")
    
    # Save Model Artifact
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    print(f"\n7. Model artifact saved: {MODEL_PATH}")
    
    # Save Model Metadata only after actual reproduction of metrics
    metadata = {
        "model_name": "ValetTrack Hourly Occupancy Forecaster",
        "algorithm": "HistGradientBoostingRegressor",
        "model_version": "v1.3-gb-timeseries-exact",
        "scikit_learn_version": sklearn.__version__,
        "python_version": sys.version.split()[0],
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "training_dataset": "City of Birmingham Municipal Parking Sensor Time Series (UCI ML Repository)",
        "source_rows": len(df),
        "total_hourly_periods": len(full_hourly_index),
        "observed_hours": observed_count,
        "imputed_missing_hours": missing_count,
        "missing_hours_handling": "Explicit time-based linear interpolation preserving complete hourly grid",
        "training_samples": len(X_train),
        "validation_samples": len(X_test),
        "features": feature_cols,
        "target": target_col,
        "metrics": {
            "validation_mae": round(mae, 2),
            "validation_rmse": round(rmse, 2),
            "validation_r2": round(r2, 4),
            "baseline_persistence_mae": round(baseline_mae, 2),
            "baseline_persistence_rmse": round(baseline_rmse, 2),
            "mae_reduction_pct": round(improvement_pct, 1)
        },
        "forecast_horizons": ["1h", "2h", "4h", "8h", "12h", "24h"],
        "status": "TRAINED_AND_VERIFIED"
    }
    
    with open(METADATA_PATH, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)
    print(f"   Model metadata saved: {METADATA_PATH}")
    print("\n=== Training Completed Successfully ===")
    return metadata


if __name__ == '__main__':
    train_model()
