import app from "./app.js";
import { env } from "./config/env.js";
import { closeQueues } from "./jobs/queue.js";
import { prisma } from "./lib/prisma.js";
import { closeReadinessResources } from "./readiness.js";
import { closeDashboardCache } from "./shared/dashboard-cache.js";

const PORT = env.PORT;

function main() {
  let shuttingDown = false;
  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  server.once("error", (error) => {
    console.error("HTTP server error", {
      name: error.name,
      code:
        "code" in error && typeof error.code === "string"
          ? error.code
          : undefined,
    });
    process.exitCode = 1;
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down`);

    server.closeIdleConnections();
    const forceCloseTimer = setTimeout(() => {
      server.closeAllConnections();
    }, 10_000);
    forceCloseTimer.unref();

    await new Promise<void>((resolve) => {
      server.close((error) => {
        if (error) {
          console.error("HTTP server shutdown failed", { name: error.name });
          process.exitCode = 1;
        }
        resolve();
      });
    });
    clearTimeout(forceCloseTimer);

    const resourceResults = await Promise.allSettled([
      closeReadinessResources(),
      closeDashboardCache(),
      closeQueues(),
    ]);
    const databaseResults = await Promise.allSettled([prisma.$disconnect()]);
    if (
      [...resourceResults, ...databaseResults].some(
        (result) => result.status === "rejected",
      )
    ) {
      console.error("One or more application resources failed to close");
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main();
