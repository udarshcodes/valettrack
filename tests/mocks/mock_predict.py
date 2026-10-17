#!/usr/bin/env python3
"""
Mock prediction script for testing inference error handling,
schema validation, zero predictions, and stale prediction rejection.
"""
import os
import sys
import json

scenario = os.getenv('MOCK_PREDICT_SCENARIO', 'malformed')

if scenario == 'malformed':
    print("This is not JSON at all! Internal syntax error or corrupt stream.")
    sys.exit(0)

elif scenario == 'invalid_schema':
    print(json.dumps(["not", "an", "object"]))
    sys.exit(0)

elif scenario == 'failed_status':
    print(json.dumps({
        "status": "FAILED",
        "message": "Simulated neural network convergence failure"
    }))
    sys.exit(0)

elif scenario == 'zero_predictions':
    print(json.dumps({
        "status": "SUCCESS",
        "mode": "historical_replay",
        "generation_time": "2026-10-17T08:00:00Z",
        "model_version": "v1.0",
        "predictions_count": 0
    }))
    sys.exit(0)

elif scenario == 'stale_prevention':
    print(json.dumps({
        "status": "SUCCESS",
        "mode": "historical_replay",
        "generation_time": "2010-01-01T00:00:00Z",
        "model_version": "nonexistent_stale_tag_999",
        "predictions_count": 18
    }))
    sys.exit(0)

elif scenario == 'crash':
    sys.stderr.write("Fatal exception: GPU device out of memory\n")
    sys.exit(1)

else:
    print(json.dumps({"status": "UNKNOWN_SCENARIO"}))
    sys.exit(0)
