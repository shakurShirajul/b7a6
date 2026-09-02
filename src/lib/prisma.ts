import { PrismaClient } from "../../prisma/generated/prisma/client";
import config from "../config";
import { PrismaPg } from "@prisma/adapter-pg";
const connectionString = config.database_url;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });
export { prisma };
