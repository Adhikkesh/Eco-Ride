import { Request, Response } from "express";

const PREDICTION_SERVICE_URL = process.env.PREDICTION_SERVICE_URL || "http://prediction:5000";

export const predictDemand = async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${PREDICTION_SERVICE_URL}/predict/demand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Error proxying predictDemand:", error);
    return res.status(500).json({ error: "Prediction service unavailable" });
  }
};

export const predictHeatmap = async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius, grid, hour, day } = req.query;
    const body = {
      center_lat: parseFloat(String(lat)),
      center_lng: parseFloat(String(lng)),
      radius_km: parseFloat(String(radius || 5)),
      grid_size: parseInt(String(grid || 4), 10),
      hour: parseInt(String(hour || new Date().getHours()), 10),
      day_of_week: parseInt(String(day || new Date().getDay()), 10),
    };
    const response = await fetch(`${PREDICTION_SERVICE_URL}/predict/demand-heatmap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Error proxying predictHeatmap:", error);
    return res.status(500).json({ error: "Prediction service unavailable" });
  }
};

export const predictSurge = async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${PREDICTION_SERVICE_URL}/predict/surge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Error proxying predictSurge:", error);
    return res.status(500).json({ error: "Prediction service unavailable" });
  }
};

export const predictForecast24h = async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${PREDICTION_SERVICE_URL}/predict/forecast-24h`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error("Error proxying predictForecast24h:", error);
    return res.status(500).json({ error: "Prediction service unavailable" });
  }
};
