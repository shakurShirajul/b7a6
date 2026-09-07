import { Prisma } from "../generated/prisma/client.js";

// All evidence writers take User before DonorProfile. Read the evidence only
// after both locks, at READ COMMITTED, so a preceding edit is always visible.
export const lockDonorEvidenceForUser = async (
  transaction: Prisma.TransactionClient,
  userId: number,
) => {
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
  `);
  await transaction.$queryRaw(Prisma.sql`
    SELECT "id" FROM "DonorProfile" WHERE "userId" = ${userId} FOR UPDATE
  `);
};

export const lockDonorEvidenceForProfile = async (
  transaction: Prisma.TransactionClient,
  donorId: number,
) => {
  const owner = await transaction.donorProfile.findUnique({
    where: { id: donorId },
    select: { userId: true },
  });
  if (owner) await lockDonorEvidenceForUser(transaction, owner.userId);
};
