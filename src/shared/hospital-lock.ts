import httpStatus from "http-status";
import { AppError } from "../errors/AppError.js";
import { Prisma } from "../generated/prisma/client.js";
import { VerificationStatus } from "../generated/prisma/enums.js";

export const lockVerifiedHospitalForRequest = async (
  transaction: Prisma.TransactionClient,
  hospitalId: number,
) => {
  const [hospital] = await transaction.$queryRaw<
    Array<{ verificationStatus: VerificationStatus; deletedAt: Date | null }>
  >(Prisma.sql`
    SELECT "verificationStatus", "deletedAt" FROM "Hospital"
    WHERE "id" = ${hospitalId} FOR SHARE
  `);
  if (!hospital || hospital.deletedAt) {
    throw new AppError(httpStatus.NOT_FOUND, "Hospital not found");
  }
  if (hospital.verificationStatus !== VerificationStatus.VERIFIED) {
    throw new AppError(
      httpStatus.CONFLICT,
      "The request hospital must remain verified and active",
    );
  }
};
