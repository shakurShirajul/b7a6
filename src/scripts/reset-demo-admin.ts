import bcrypt from "bcryptjs";
import config from "../config/index.js";
import { prisma } from "../lib/prisma.js";
import { recordAuditEvent } from "../shared/audit.js";

const email = "admin.demo@blood.local";

const main = async () => {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("Set a dedicated DEMO_PASSWORD of at least 12 characters");
  }
  const passwordHash = await bcrypt.hash(password, config.bcrypt_salt_rounds);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "email" = ${email} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { email } });
    if (
      !user ||
      user.role !== "ADMIN" ||
      user.status !== "ACTIVE" ||
      user.deletedAt
    ) {
      throw new Error(
        "Recovery requires the existing active demo administrator",
      );
    }
    await tx.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    });
    await tx.refreshSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAuditEvent(
      {
        actorId: user.id,
        action: "DEMO_ADMIN_CREDENTIAL_ROTATED",
        entityType: "User",
        entityId: String(user.id),
        after: { reason: "Dedicated demo account access recovery" },
      },
      tx,
    );
  });
  console.log(
    `Recovered ${email}; use the private DEMO_PASSWORD value to log in.`,
  );
};

main()
  .catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Demo admin recovery failed",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
