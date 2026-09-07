import { prisma } from "../lib/prisma.js";
import { closeDashboardCache } from "../shared/dashboard-cache.js";
import { startWorkers } from "./workers.js";

const main = async () => {
  let stopWorkers: (() => Promise<void>) | undefined;
  let shuttingDown = false;
  try {
    stopWorkers = await startWorkers();
    console.log("Background workers started");
  } catch {
    console.error("Background workers could not be started");
    process.exitCode = 1;
    await closeDashboardCache();
    await prisma.$disconnect();
    return;
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down workers`);
    let cleanupFailed = false;
    try {
      await stopWorkers?.();
    } catch {
      cleanupFailed = true;
    }
    try {
      await closeDashboardCache();
    } catch {
      cleanupFailed = true;
    }
    try {
      await prisma.$disconnect();
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) {
      console.error("One or more worker resources failed to close");
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
};

void main();
