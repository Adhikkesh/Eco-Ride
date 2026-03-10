# ── Eco-Ride LSTM Prediction Service ──────────────────────────
FROM python:3.11-slim

# Prevent Python from writing .pyc / buffering stdout
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install dependencies first (layer caching)
COPY apps/backend/prediction-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the trained model
COPY Model/global_ecoride_lstm.h5 model/global_ecoride_lstm.h5

# Copy application code
COPY apps/backend/prediction-service/app.py .

# Default env vars
ENV MODEL_PATH=model/global_ecoride_lstm.h5 \
    PORT=5000

EXPOSE 5000

# Run with Gunicorn (1 worker – TF models are not fork-safe)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "120", "app:app"]
