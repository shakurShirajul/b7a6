import { PrismaClient } from "../generated/prisma/client.js";
import config from "../config/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
const connectionString = config.database_url;
const adapter = new PrismaPg({
  connectionString,
  connectionTimeoutMillis: config.database.connection_timeout_ms,
  query_timeout: config.database.query_timeout_ms,
  statement_timeout: config.database.statement_timeout_ms,
});
const prisma = new PrismaClient({ adapter });
export { prisma };
