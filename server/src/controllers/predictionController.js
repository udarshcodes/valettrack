import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import { query } from '../db/index.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODEL_DIR = path.resolve(__dirname, '../../../data/models');
const METADATA_FILE = path.join(MODEL_DIR, 'model_metadata.json');

export async function getModelStatus(req, res, next) {
  try {
    if (!fs.existsSync(METADATA_FILE)) {
      return res.json({
        model_available: false,
        status: 'UNAVAILABLE',
        message: 'No trained machine learning model found in repository. Train using npm run ml:train.'
      });
    }

    const metadataRaw = fs.readFileSync(METADATA_FILE, 'utf-8');
    const metadata = JSON.parse(metadataRaw);

    const counts = await query(`
      SELECT 
        (SELECT COUNT(*) FROM occupancy_predictions) as occupancy_predictions_count,
        (SELECT COUNT(*) FROM pricing_predictions) as pricing_predictions_count
    `);

    res.json({
      model_available: true,
      model_status: 'ACTIVE',
      status: 'ACTIVE',
      metadata: {
        ...metadata,
        algorithm: metadata.algorithm,
        metrics: {
          ...metadata.metrics,
          mae: metadata.metrics.validation_mae,
          rmse: metadata.metrics.validation_rmse,
          r2: metadata.metrics.validation_r2,
          error_reduction_pct: metadata.metrics.mae_reduction_pct
        }
      },
      ...metadata,
      stored_predictions: {
        occupancy_predictions: parseInt(counts.rows[0].occupancy_predictions_count, 10),
        pricing_predictions: parseInt(counts.rows[0].pricing_predictions_count, 10)
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function runPredictionInference(req, res, next) {
  try {
    if (!fs.existsSync(METADATA_FILE)) {
      return res.status(400).json({
        error: 'ModelNotTrained',
        message: 'Cannot run inference: machine learning model has not been trained yet.'
      });
    }

    const pythonScript = path.resolve(__dirname, '../../../scripts/predict_occupancy.py');
    const { stdout, stderr } = await execAsync(`python "${pythonScript}"`);

    // Fetch the newly inserted predictions
    const latestOccupancy = await query(`
      SELECT 
        op.prediction_id,
        op.prediction_time,
        op.slot_type_id,
        st.type_name as slot_type,
        op.time_slot,
        op.predicted_occupancy,
        op.model_version
      FROM occupancy_predictions op
      JOIN slot_types st ON op.slot_type_id = st.slot_type_id
      ORDER BY op.prediction_time DESC, op.prediction_id DESC
      LIMIT 12
    `);

    const latestPricing = await query(`
      SELECT 
        pp.pricing_id,
        pp.prediction_time,
        pp.slot_type_id,
        st.type_name as slot_type,
        pp.time_slot,
        pp.occupancy_pct,
        pp.suggested_rate,
        pp.model_version
      FROM pricing_predictions pp
      JOIN slot_types st ON pp.slot_type_id = st.slot_type_id
      ORDER BY pp.prediction_time DESC, pp.pricing_id DESC
      LIMIT 12
    `);

    res.status(201).json({
      message: 'Predictions successfully generated and stored in database.',
      occupancy_predictions: latestOccupancy.rows,
      pricing_predictions: latestPricing.rows
    });
  } catch (err) {
    next(err);
  }
}
