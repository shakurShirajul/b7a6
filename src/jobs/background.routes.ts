import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import config from "../config/index.js";
import { runBackgroundJobs } from "./background.js";

export const createBackgroundHandler =
  (run = runBackgroundJobs, secret = config.cron_secret): RequestHandler =>
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!secret) {
      res
        .status(503)
        .json({ success: false, message: "Scheduled jobs are not configured" });
      return;
    }
    const actual = Buffer.from(req.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }
    try {
      const data = await run();
      const success =
        data.emails.failed === 0 &&
        data.matching.failed === 0 &&
        data.publication.deferred === 0;
      res.status(success ? 200 : 503).json({ success, data });
    } catch {
      console.error("Scheduled background sweep failed");
      res.status(503).json({
        success: false,
        message: "Background processing failed; retry scheduled invocation",
      });
    }
  };
