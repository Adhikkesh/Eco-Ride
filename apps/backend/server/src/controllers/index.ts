import type { RequestHandler } from "express";
import status from "http-status";

export const HealthCheckController: RequestHandler = (_req, res) => {
  res.status(status.OK).json({ msg: `Hello There ${status["200_MESSAGE"]}` });
};

export const GetMeController: RequestHandler = (req, res) => {
  res
    .status(status.OK)
    .json({ data: req.user ? req.user : null, msg: `Hello There ${status["200_MESSAGE"]}` });
};
