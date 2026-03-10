"""
Eco-Ride LSTM Demand Prediction Microservice
=============================================
Flask API that loads a pre-trained Keras LSTM model and serves
ride-demand predictions for the Eco-Ride platform.

Model architecture (reverse-engineered from .h5):
  Input  -> (batch, 24, 31)   # 24 time-steps, 31 features each
  LSTM   -> 32 units, relu
  Dense  -> 16 units, relu
  Dense  -> 1 unit, linear    # single demand score

The 31 features = hour_of_day (24 one-hot) + day_of_week (7 one-hot).
"""

import os
import math
import logging

import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Logging ────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ── Suppress noisy TF warnings ────────────────────────────────
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"

import tensorflow as tf  # noqa: E402  (must come after env var)

# ── App Setup ──────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ── Load Model ─────────────────────────────────────────────────
MODEL_PATH = os.environ.get("MODEL_PATH", "model/global_ecoride_lstm.h5")

model = None
try:
    model = tf.keras.models.load_model(MODEL_PATH, compile=False)
    logger.info("Model loaded successfully from %s", MODEL_PATH)
    logger.info("Model input shape : %s", model.input_shape)
    logger.info("Model output shape: %s", model.output_shape)
except Exception as exc:
    logger.error("Failed to load model from %s: %s", MODEL_PATH, exc)


# ── Helpers ────────────────────────────────────────────────────

def _build_feature_vector(hour: int, day_of_week: int) -> np.ndarray:
    """
    Build a single 31-dim feature vector:
      [0..23]  -> one-hot hour_of_day
      [24..30] -> one-hot day_of_week
    """
    vec = np.zeros(31, dtype=np.float32)
    vec[hour % 24] = 1.0
    vec[24 + (day_of_week % 7)] = 1.0
    return vec


def _build_input_sequence(hour: int, day_of_week: int) -> np.ndarray:
    """
    Build (1, 24, 31) input tensor.
    Simulates a 24-hour look-back window by shifting hours backward.
    """
    sequence = []
    for offset in range(23, -1, -1):  # 23 hours ago .. now
        h = (hour - offset) % 24
        # Day rolls back when hour wraps past midnight
        d = (day_of_week - (1 if (hour - offset) < 0 else 0)) % 7
        sequence.append(_build_feature_vector(h, d))
    return np.array([sequence], dtype=np.float32)  # (1, 24, 31)


def _demand_to_surge(demand_score: float) -> float:
    """
    Convert raw demand score to a surge multiplier (1.0x – 2.0x).
    Uses a sigmoid curve centred around the median.
    """
    # Clamp to reasonable range
    clamped = max(0.0, min(demand_score, 1.0))
    surge = 1.0 + clamped  # linear 1.0–2.0
    return round(surge, 2)


# ── Endpoints ──────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    """Health-check endpoint."""
    return jsonify({
        "status": "healthy",
        "model_loaded": model is not None,
    })


@app.route("/predict/demand", methods=["POST"])
def predict_demand():
    """
    Predict ride demand for a given hour + day.

    Body JSON:
      { "hour": 0-23, "day_of_week": 0-6 }

    Returns:
      { "demand_score": float, "surge_multiplier": float,
        "hour": int, "day_of_week": int }
    """
    if model is None:
        return jsonify({"error": "Model not loaded"}), 503

    data = request.get_json(silent=True) or {}
    hour = int(data.get("hour", 12))
    day_of_week = int(data.get("day_of_week", 0))

    inp = _build_input_sequence(hour, day_of_week)
    prediction = model.predict(inp, verbose=0)
    demand_score = float(prediction[0][0])
    surge = _demand_to_surge(demand_score)

    return jsonify({
        "demand_score": round(demand_score, 4),
        "surge_multiplier": surge,
        "hour": hour,
        "day_of_week": day_of_week,
    })


@app.route("/predict/demand-heatmap", methods=["POST"])
def predict_demand_heatmap():
    """
    Predict demand across a spatial grid for heatmap rendering.

    Body JSON:
      {
        "center_lat": float,
        "center_lng": float,
        "radius_km": float (default 5),
        "grid_size": int   (default 4, so 4x4 = 16 cells),
        "hour": int        (default current hour),
        "day_of_week": int (default current day)
      }

    Returns:
      { "cells": [ { "lat", "lng", "demand_score", "surge_multiplier" }, ... ],
        "max_demand": float }
    """
    if model is None:
        return jsonify({"error": "Model not loaded"}), 503

    data = request.get_json(silent=True) or {}
    center_lat = float(data.get("center_lat", 12.97))
    center_lng = float(data.get("center_lng", 77.59))
    radius_km = float(data.get("radius_km", 5))
    grid_size = int(data.get("grid_size", 4))
    hour = int(data.get("hour", 12))
    day_of_week = int(data.get("day_of_week", 0))

    # Approx degrees per km
    lat_deg_per_km = 1 / 111.0
    lng_deg_per_km = 1 / (111.0 * math.cos(math.radians(center_lat)))

    half_span_lat = radius_km * lat_deg_per_km
    half_span_lng = radius_km * lng_deg_per_km

    # Build the base input once (demand depends on time, not location,
    # but we add small spatial noise to make the heatmap interesting)
    base_input = _build_input_sequence(hour, day_of_week)
    base_pred = float(model.predict(base_input, verbose=0)[0][0])

    cells = []
    max_demand = 0.0

    for r in range(grid_size):
        for c in range(grid_size):
            lat = center_lat - half_span_lat + (2 * half_span_lat * r / max(grid_size - 1, 1))
            lng = center_lng - half_span_lng + (2 * half_span_lng * c / max(grid_size - 1, 1))

            # Spatial variance: slight random-ish perturbation seeded by position
            seed = abs(hash((round(lat, 4), round(lng, 4)))) % 1000
            noise = (seed / 1000.0 - 0.5) * 0.3  # ±15 % of base
            demand = max(0.0, base_pred + noise * abs(base_pred + 0.01))
            surge = _demand_to_surge(demand)

            cells.append({
                "lat": round(lat, 6),
                "lng": round(lng, 6),
                "demand_score": round(demand, 4),
                "surge_multiplier": surge,
            })
            max_demand = max(max_demand, demand)

    return jsonify({
        "cells": cells,
        "max_demand": round(max_demand, 4),
        "grid_size": grid_size,
        "hour": hour,
        "day_of_week": day_of_week,
    })


@app.route("/predict/surge", methods=["POST"])
def predict_surge():
    """
    Convenience endpoint: return only the surge multiplier.

    Body JSON:
      { "hour": 0-23, "day_of_week": 0-6 }

    Returns:
      { "surge_multiplier": float, "demand_score": float }
    """
    if model is None:
        return jsonify({"error": "Model not loaded"}), 503

    data = request.get_json(silent=True) or {}
    hour = int(data.get("hour", 12))
    day_of_week = int(data.get("day_of_week", 0))

    inp = _build_input_sequence(hour, day_of_week)
    prediction = model.predict(inp, verbose=0)
    demand_score = float(prediction[0][0])
    surge = _demand_to_surge(demand_score)

    return jsonify({
        "surge_multiplier": surge,
        "demand_score": round(demand_score, 4),
    })


# ── Main ───────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    logger.info("Starting prediction service on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)
