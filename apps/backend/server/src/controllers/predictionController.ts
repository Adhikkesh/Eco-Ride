import { Request, Response } from "express";

const PREDICTION_SERVICE_URL = process.env.PREDICTION_SERVICE_URL || "http://prediction:5000";

export const predictDemand = async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${PREDICTION_SERVICE_URL}/predict/demand`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    
    if (!response.ok) throw new Error("Service returned non-200");
    
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.warn("Prediction service unavailable, using robust mock demand data.");
    return res.status(200).json({
      demand_score: 1.5,
      demand_level: "high",
      surge_multiplier: 1.25,
      is_mock: true
    });
  }
};

export const predictHeatmap = async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius, grid, hour, day } = req.query;
    const center_lat = parseFloat(String(lat));
    const center_lng = parseFloat(String(lng));
    const radius_km = parseFloat(String(radius || 5));
    const grid_size = parseInt(String(grid || 4), 10);
    
    const body = {
      center_lat,
      center_lng,
      radius_km,
      grid_size,
      hour: parseInt(String(hour || new Date().getHours()), 10),
      day_of_week: parseInt(String(day || new Date().getDay()), 10),
    };
    
    const response = await fetch(`${PREDICTION_SERVICE_URL}/predict/demand-heatmap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) throw new Error("Service returned non-200");

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.warn("Prediction service unavailable, generating mock heatmap grid.");
    
    const { lat, lng, radius, grid } = req.query;
    const center_lat = parseFloat(String(lat));
    const center_lng = parseFloat(String(lng));
    const grid_size = parseInt(String(grid || 5), 10);
    
    const cells = [];
    const stepLat = 0.015;
    const stepLng = 0.015;
    const levels = ["low", "medium", "high", "very_high"];
    
    // Generate a synthetic grid around the driver
    for (let x = -Math.floor(grid_size / 2); x <= Math.floor(grid_size / 2); x++) {
      for (let y = -Math.floor(grid_size / 2); y <= Math.floor(grid_size / 2); y++) {
        const offset = Math.abs(x) + Math.abs(y);
        // Center is hot, edges are cool
        let levelIndex = 3 - Math.min(3, Math.floor(offset / 1.5));
        if (Math.random() > 0.7) levelIndex = Math.max(0, levelIndex - 1);
        
        cells.push({
          lat: center_lat + x * stepLat,
          lng: center_lng + y * stepLng,
          demand_score: 1.0 + levelIndex * 0.5,
          demand_level: levels[levelIndex],
          surge_multiplier: 1.0 + levelIndex * 0.15,
        });
      }
    }
    
    return res.status(200).json({ 
      cells, 
      max_demand: 2.5,
      is_mock: true 
    });
  }
};

export const predictSurge = async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${PREDICTION_SERVICE_URL}/predict/surge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    
    if (!response.ok) throw new Error("Service returned non-200");

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.warn("Prediction service unavailable, using mock surge data.");
    return res.status(200).json({
      surge_multiplier: 1.25,
      is_mock: true
    });
  }
};

export const predictForecast24h = async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${PREDICTION_SERVICE_URL}/predict/forecast-24h`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    
    if (!response.ok) throw new Error("Service returned non-200");

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.warn("Prediction service unavailable, using mock 24h forecast data.");
    
    const forecast = Array.from({ length: 24 }).map((_, i) => {
      // Create a nice twin-peak curve for morning and evening rush hours
      let b = 1.0;
      if (i >= 7 && i <= 10) b = 1.5 + Math.random() * 0.5; // Morning peak
      if (i >= 16 && i <= 20) b = 1.8 + Math.random() * 0.7; // Evening peak
      
      let level = "low";
      if (b >= 2.0) level = "very_high";
      else if (b >= 1.6) level = "high";
      else if (b >= 1.3) level = "medium";
      
      return {
        hour: i,
        demand_score: b,
        demand_level: level,
        surge_multiplier: Math.max(1.0, b * 0.6)
      };
    });
    
    return res.status(200).json({ 
      forecast,
      is_mock: true 
    });
  }
};
