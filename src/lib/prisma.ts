import { PrismaClient } from "../generated/prisma/client.js";
import config from "../config/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
const connectionString = config.database_url;
// Prisma's pooled endpoint rejects statement_timeout in the startup packet.
// Keep connection and client query deadlines without sending that parameter.
const adapter = new PrismaPg({
  connectionString,
  connectionTimeoutMillis: config.database.connection_timeout_ms,
  query_timeout: config.database.query_timeout_ms,
});
const prisma = new PrismaClient({ adapter });
export { prisma };
