#!/usr/bin/env python3
"""
ML Prediction Worker — managed by Node.js via child_process.
NO web framework. Communicates with Node.js via stdin/stdout JSON lines.

- Loads TF model and scaler ONCE on startup (fast after that)
- Reads prediction requests from stdin (one JSON per line)
- Writes prediction results to stdout (one JSON per line)
- Signals readiness by printing {"status":"ready"}

DO NOT run this manually. server.js starts it automatically.
"""

import sys
import json
import os

# Suppress TensorFlow logs (they'd corrupt our JSON stdout)
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

import pandas as pd         # noqa: E402
import joblib               # noqa: E402

from tensorflow.keras.models import load_model  # noqa: E402

# ── Load artifacts once on startup ────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS   = os.path.join(BASE_DIR, "artifacts")

scaler      = joblib.load(os.path.join(ARTIFACTS, "scaler.pkl"))
feat_cols   = joblib.load(os.path.join(ARTIFACTS, "feature_columns.pkl"))
model       = load_model(os.path.join(ARTIFACTS, "churn_model.keras"))

NUMERIC = {"SeniorCitizen", "tenure", "MonthlyCharges", "TotalCharges"}


def encode_input(raw: dict) -> object:
    """
    Mirrors pd.get_dummies(drop_first=True) applied during training.
    Parses feature column names like "InternetService_Fiber optic" to determine
    original column ("InternetService") and category ("Fiber optic"), then
    produces a correctly encoded row without needing the full training dataset.
    """
    row = {}
    for feat in feat_cols:
        if feat in NUMERIC:
            row[feat] = float(raw.get(feat, 0))
        else:
            # Split on FIRST underscore only.
            # e.g. "MultipleLines_No phone service" → col="MultipleLines", val="No phone service"
            sep = feat.index("_")
            orig_col = feat[:sep]
            category = feat[sep + 1:]
            row[feat] = 1 if str(raw.get(orig_col, "")) == category else 0

    df = pd.DataFrame([row])[feat_cols]
    return scaler.transform(df)


# ── Signal Node.js that we are ready ─────────────────────────────────────────
print(json.dumps({"status": "ready"}), flush=True)

# ── Prediction loop ──────────────────────────────────────────────────────────
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        raw   = json.loads(line)
        X     = encode_input(raw)
        prob  = float(model.predict(X, verbose=0).ravel()[0])
        churn = bool(prob > 0.5)
        risk  = "High" if prob >= 0.7 else "Medium" if prob >= 0.4 else "Low"

        print(json.dumps({
            "churn_probability": round(prob, 4),
            "churn":             churn,
            "risk_level":        risk,
        }), flush=True)

    except Exception as exc:
        print(json.dumps({"error": str(exc)}), flush=True)
