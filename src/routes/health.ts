import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      service: "word-atlas-api",
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});
