import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query } from '../db/index.js';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODEL_DIR = path.resolve(__dirname, '../../../data/models');
const METADATA_FILE = path.join(MODEL_DIR, 'model_metadata.json');
const MODEL_FILE = path.join(MODEL_DIR, 'occupancy_forecaster.joblib');

export async function getModelStatus(req, res, next) {
  try {
    if (!fs.existsSync(METADATA_FILE) || !fs.existsSync(MODEL_FILE)) {
      return res.json({
        model_available: false,
        status: 'UNAVAILABLE',
        message: 'Trained model artifacts (occupancy_forecaster.joblib and model_metadata.json) not found in repository. Train using npm run ml:train.'
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

function extractJsonFromOutput(stdout) {
  if (!stdout || typeof stdout !== 'string') return null;
  const objStart = stdout.indexOf('{');
  const arrStart = stdout.indexOf('[');
  let firstIdx = -1;
  let lastIdx = -1;

  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    firstIdx = objStart;
    lastIdx = stdout.lastIndexOf('}');
  } else if (arrStart !== -1) {
    firstIdx = arrStart;
    lastIdx = stdout.lastIndexOf(']');
  }

  if (firstIdx === -1 || lastIdx === -1 || lastIdx <= firstIdx) return null;

  let idx = firstIdx;
  while (idx !== -1 && idx < lastIdx) {
    try {
      const candidate = stdout.slice(idx, lastIdx + 1);
      return JSON.parse(candidate);
    } catch {
      idx = stdout.indexOf(stdout[firstIdx], idx + 1);
    }
  }
  return null;
}

export async function runPredictionInference(req, res, next) {
  try {
    if (!fs.existsSync(METADATA_FILE) || !fs.existsSync(MODEL_FILE)) {
      return res.status(400).json({
        error: 'ModelNotTrained',
        message: 'Cannot run inference: machine learning model artifact or metadata has not been trained yet. Run npm run ml:train first.'
      });
    }

    const ALLOWED_MODES = ['historical_replay', 'operational'];
    const rawMode = req.body?.mode || req.query?.mode || 'historical_replay';
    if (typeof rawMode !== 'string' || !ALLOWED_MODES.includes(rawMode.trim().toLowerCase())) {
      return res.status(400).json({
        error: 'ValidationError',
        code: 'InvalidPredictionMode',
        message: `Invalid prediction mode '${rawMode}'. Allowed modes are: ${ALLOWED_MODES.join(', ')}`
      });
    }
    const mode = rawMode.trim().toLowerCase();

    const pythonPath = process.env.PYTHON_PATH || 'python';
    const pythonScript = process.env.PREDICTION_SCRIPT_PATH || path.resolve(__dirname, '../../../scripts/predict_occupancy.py');

    let execResult;
    try {
      execResult = await execFileAsync(pythonPath, [pythonScript, '--mode', mode, '--json'], {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      });
    } catch (execErr) {
      return res.status(500).json({
        error: 'InferenceExecutionError',
        code: 'PythonProcessFailed',
        message: execErr.message || 'Python inference process failed to execute.',
        stderr: execErr.stderr ? String(execErr.stderr).slice(0, 1000) : undefined
      });
    }

    const { stdout, stderr } = execResult;
    const parsedResult = extractJsonFromOutput(stdout);

    if (!parsedResult) {
      return res.status(500).json({
        error: 'InferenceExecutionError',
        code: 'MalformedInferenceOutput',
        message: 'Prediction inference failed: Python process returned invalid or non-JSON output.',
        stdout: stdout ? stdout.slice(0, 1000) : undefined,
        stderr: stderr ? stderr.slice(0, 1000) : undefined
      });
    }

    if (typeof parsedResult !== 'object' || Array.isArray(parsedResult) || !parsedResult.status) {
      return res.status(500).json({
        error: 'InferenceExecutionError',
        code: 'InvalidInferenceSchema',
        message: 'Prediction inference returned an unrecognized data schema without a status field.',
        details: parsedResult
      });
    }

    if (parsedResult.status === 'INSUFFICIENT_CURRENT_DATA') {
      return res.status(200).json({
        status: 'INSUFFICIENT_CURRENT_DATA',
        mode: 'operational',
        message: parsedResult.message || 'Insufficient operational data for inference.',
        generation_time: parsedResult.generation_time,
        missing_hours_count: parsedResult.missing_hours_count
      });
    }

    if (parsedResult.status !== 'SUCCESS') {
      return res.status(500).json({
        error: 'InferenceExecutionError',
        code: 'InferenceStatusFailed',
        message: parsedResult.message || `Prediction inference reported unsuccessful status: ${parsedResult.status}`,
        details: parsedResult
      });
    }

    const predCount = parseInt(parsedResult.predictions_count, 10);
    if (isNaN(predCount) || predCount <= 0) {
      return res.status(500).json({
        error: 'InferenceExecutionError',
        code: 'ZeroPredictionsGenerated',
        message: 'Prediction inference finished with status SUCCESS but reported zero generated predictions.',
        details: parsedResult
      });
    }

    const genTime = parsedResult.generation_time;
    const modelVer = parsedResult.model_version;
    if (!genTime || !modelVer) {
      return res.status(500).json({
        error: 'InferenceExecutionError',
        code: 'MissingProvenanceMetadata',
        message: 'Prediction inference result is missing required generation_time or model_version metadata.',
        details: parsedResult
      });
    }

    // Fetch ONLY the freshly inserted predictions matching the exact generation run
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
      WHERE op.prediction_time = $1 AND op.model_version = $2
      ORDER BY op.prediction_id ASC
    `, [genTime, modelVer]);

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
      WHERE pp.prediction_time = $1 AND pp.model_version = $2
      ORDER BY pp.pricing_id ASC
    `, [genTime, modelVer]);

    if (latestOccupancy.rows.length === 0 || latestPricing.rows.length === 0) {
      return res.status(500).json({
        error: 'InferencePersistenceError',
        code: 'FreshPredictionsNotFound',
        message: `Inference reported success for generation time '${genTime}', but fresh predictions were not found in database. Stale records were rejected.`
      });
    }

    res.status(201).json({
      message: 'Predictions successfully generated and stored in database.',
      mode,
      details: parsedResult,
      occupancy_predictions: latestOccupancy.rows,
      pricing_predictions: latestPricing.rows
    });
  } catch (err) {
    next(err);
  }
}
