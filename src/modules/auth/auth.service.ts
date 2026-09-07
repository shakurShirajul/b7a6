import { createHmac, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import jwt, { type SignOptions } from "jsonwebtoken";
import config from "../../config/index.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { Role, UserStatus } from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditEvent } from "../../shared/audit.js";
import { invalidateDashboardCache } from "../../shared/dashboard-cache.js";
import type {
  TJwtPayload,
  TLoginPayload,
  TRegisterPayload,
  TRequestContext,
} from "./auth.interface.js";
import type { GoogleIdentity } from "./google.strategy.js";

const dummyPasswordHash = bcrypt.hashSync(
  "Dummy credential work only - never a login password",
  config.bcrypt_salt_rounds,
);

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatar: true,
  role: true,
  status: true,
  dateOfBirth: true,
  gender: true,
  emailVerifiedAt: true,
  createdAt: true,
  updatedAt: true,
  patientProfile: {
    select: {
      id: true,
      bloodType: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      totalReceivedCount: true,
    },
  },
  donorProfile: {
    select: {
      id: true,
      bloodType: true,
      verificationStatus: true,
      weightKg: true,
      totalDonationCount: true,
      lastDonationDate: true,
      division: true,
      district: true,
      area: true,
    },
  },
} satisfies Prisma.UserSelect;

const createToken = (
  payload: TJwtPayload,
  secret: string,
  expiresIn: SignOptions["expiresIn"],
) => jwt.sign(payload, secret, { expiresIn });

const createAuthTokens = (
  user: Pick<TJwtPayload, "userId" | "email" | "role">,
) => {
  const jti = randomUUID();
  const accessToken = createToken(
    { ...user, tokenType: "access" },
    config.jwt_access_secret,
    config.jwt_access_expires_in,
  );
  const refreshToken = createToken(
    { ...user, tokenType: "refresh", jti },
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in,
  );
  const decodedRefreshToken = jwt.decode(refreshToken);

  if (
    !decodedRefreshToken ||
    typeof decodedRefreshToken === "string" ||
    typeof decodedRefreshToken.exp !== "number"
  ) {
    throw new Error("Refresh token expiration could not be determined");
  }

  return {
    accessToken,
    refreshToken,
    jti,
    expiresAt: new Date(decodedRefreshToken.exp * 1000),
  };
};

const hashRefreshToken = (refreshToken: string) =>
  bcrypt.hash(refreshToken, config.bcrypt_salt_rounds);

const assertRefreshPayload = (decoded: string | jwt.JwtPayload) => {
  if (
    typeof decoded === "string" ||
    decoded["tokenType"] !== "refresh" ||
    typeof decoded["jti"] !== "string" ||
    typeof decoded["userId"] !== "number"
  ) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
  }

  return decoded as TJwtPayload & jwt.JwtPayload & { jti: string };
};

const verifyRefreshToken = (token: string) => {
  try {
    return assertRefreshPayload(
      jwt.verify(token, config.jwt_refresh_secret, { algorithms: ["HS256"] }),
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
  }
};

const failedLoginEntityId = (email: string) =>
  `email:${createHmac("sha256", config.jwt_access_secret)
    .update(email)
    .digest("hex")
    .slice(0, 20)}`;

const recordFailedLogin = async (email: string, context: TRequestContext) => {
  try {
    await recordAuditEvent({
      action: "AUTH_LOGIN_FAILED",
      entityType: "LoginAttempt",
      entityId: failedLoginEntityId(email),
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  } catch {
    // Authentication failures must not disclose audit storage availability.
  }
};

const googleIdentityAuditId = (identity: GoogleIdentity) =>
  `google:${createHmac("sha256", config.jwt_access_secret)
    .update(identity.provider)
    .update("\0")
    .update(identity.providerAccountId)
    .update("\0")
    .update(identity.email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 20)}`;

class GoogleLoginFailure extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly reasonCode: string,
  ) {
    super(message);
    this.name = "GoogleLoginFailure";
  }
}

const recordGoogleLoginFailure = async (
  identity: GoogleIdentity,
  reasonCode: string,
  context: TRequestContext,
) => {
  try {
    await recordAuditEvent({
      action: "AUTH_GOOGLE_LOGIN_FAILED",
      entityType: "GoogleLoginAttempt",
      entityId: googleIdentityAuditId(identity),
      after: { reasonCode },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  } catch {
    // Authentication failures must not disclose audit storage availability.
  }
};

const register = async (
  payload: TRegisterPayload,
  context: TRequestContext,
) => {
  const passwordHash = await bcrypt.hash(
    payload.password,
    config.bcrypt_salt_rounds,
  );

  const user = await prisma.$transaction(async (transaction) => {
    const commonData = {
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
      password: passwordHash,
      role: payload.role,
      avatar: payload.avatar,
      dateOfBirth: payload.dateOfBirth,
      gender: payload.gender,
    };

    const user = await transaction.user.create({
      data:
        payload.role === Role.PATIENT
          ? {
              ...commonData,
              patientProfile: {
                create: {
                  bloodType: payload.bloodType,
                  emergencyContactName: payload.emergencyContactName,
                  emergencyContactPhone: payload.emergencyContactPhone,
                },
              },
            }
          : {
              ...commonData,
              donorProfile: {
                create: {
                  bloodType: payload.bloodType,
                  isAvailable: false,
                  weightKg: payload.weightKg,
                  division: payload.division,
                  district: payload.district,
                  area: payload.area,
                  latitude: payload.latitude,
                  longitude: payload.longitude,
                },
              },
            },
      select: publicUserSelect,
    });

    await recordAuditEvent(
      {
        actorId: user.id,
        action: "AUTH_REGISTERED",
        entityType: "User",
        entityId: String(user.id),
        after: { role: user.role, status: user.status },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );

    return user;
  });
  await invalidateDashboardCache();
  return user;
};

const login = async (payload: TLoginPayload, context: TRequestContext) => {
  const user = await prisma.user.findUnique({
    where: { email: payload.email },
    select: {
      id: true,
      name: true,
      email: true,
      password: true,
      role: true,
      status: true,
      deletedAt: true,
    },
  });

  const isPasswordMatched = await bcrypt.compare(
    payload.password,
    user?.password ?? dummyPasswordHash,
  );

  if (!user || !isPasswordMatched) {
    await recordFailedLogin(payload.email, context);
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid email or password");
  }

  if (user.status !== UserStatus.ACTIVE || user.deletedAt) {
    await recordFailedLogin(payload.email, context);
    throw new AppError(httpStatus.FORBIDDEN, "User account is not active");
  }

  const tokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  const tokens = createAuthTokens(tokenPayload);
  const tokenHash = await hashRefreshToken(tokens.refreshToken);
  const loggedInAt = new Date();

  await prisma.$transaction(async (transaction) => {
    // Coordinate token issuance with seed credential/session rotation.
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    const current = await transaction.user.findUnique({
      where: { id: user.id },
      select: { password: true, role: true, status: true, deletedAt: true },
    });
    if (
      !current ||
      current.password !== user.password ||
      current.role !== user.role ||
      current.status !== UserStatus.ACTIVE ||
      current.deletedAt
    ) {
      throw new AppError(
        httpStatus.UNAUTHORIZED,
        "Account credentials changed. Please sign in again.",
      );
    }
    await transaction.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash,
        jti: tokens.jti,
        expiresAt: tokens.expiresAt,
      },
    });
    await transaction.user.update({
      where: { id: user.id },
      data: { lastLoginAt: loggedInAt },
    });
    await recordAuditEvent(
      {
        actorId: user.id,
        action: "AUTH_LOGIN_SUCCEEDED",
        entityType: "RefreshSession",
        entityId: tokens.jti,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
  });

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  };
};

const refresh = async (token: string, context: TRequestContext) => {
  const decoded = verifyRefreshToken(token);
  const now = new Date();
  const session = await prisma.refreshSession.findUnique({
    where: { jti: decoded.jti },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  });

  if (
    !session ||
    session.userId !== decoded.userId ||
    session.revokedAt ||
    session.expiresAt <= now
  ) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
  }

  if (session.user.status !== UserStatus.ACTIVE || session.user.deletedAt) {
    throw new AppError(httpStatus.FORBIDDEN, "User account is not active");
  }

  if (!(await bcrypt.compare(token, session.tokenHash))) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
  }

  const tokens = createAuthTokens({
    userId: session.user.id,
    email: session.user.email,
    role: session.user.role,
  });
  const tokenHash = await hashRefreshToken(tokens.refreshToken);

  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
    const current = await transaction.user.findUnique({
      where: { id: session.userId },
      select: { role: true, status: true, deletedAt: true },
    });
    if (
      !current ||
      current.role !== session.user.role ||
      current.status !== UserStatus.ACTIVE ||
      current.deletedAt
    ) {
      throw new AppError(httpStatus.UNAUTHORIZED, "User account is inactive");
    }
    const revoked = await transaction.refreshSession.updateMany({
      where: {
        id: session.id,
        userId: session.userId,
        jti: decoded.jti,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });

    if (revoked.count !== 1) {
      throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
    }

    await transaction.refreshSession.create({
      data: {
        userId: session.userId,
        tokenHash,
        jti: tokens.jti,
        expiresAt: tokens.expiresAt,
      },
    });
    await recordAuditEvent(
      {
        actorId: session.userId,
        action: "AUTH_REFRESH_ROTATED",
        entityType: "RefreshSession",
        entityId: tokens.jti,
        before: { jti: decoded.jti },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
  });

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
};

const logout = async (token: string, context: TRequestContext) => {
  let decoded: ReturnType<typeof verifyRefreshToken> | undefined;
  try {
    decoded = verifyRefreshToken(token);
  } catch {
    return;
  }

  if (!decoded) return;
  const decodedUserId = decoded.userId;
  const decodedJti = decoded.jti;

  const session = await prisma.refreshSession.findUnique({
    where: { jti: decodedJti },
    select: { id: true, userId: true, tokenHash: true, revokedAt: true },
  });

  if (
    !session ||
    session.userId !== decodedUserId ||
    session.revokedAt ||
    !(await bcrypt.compare(token, session.tokenHash))
  ) {
    return;
  }

  await prisma.$transaction(async (transaction) => {
    const revoked = await transaction.refreshSession.updateMany({
      where: {
        id: session.id,
        userId: decodedUserId,
        jti: decodedJti,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    if (revoked.count === 1) {
      await recordAuditEvent(
        {
          actorId: session.userId,
          action: "AUTH_LOGOUT",
          entityType: "RefreshSession",
          entityId: decodedJti,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );
    }
  });
};

const loginWithGoogleOnce = (
  identity: GoogleIdentity,
  context: TRequestContext,
  linkUserId?: number,
) =>
  prisma.$transaction(async (transaction) => {
    const existingAccount = await transaction.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: identity.provider,
          providerAccountId: identity.providerAccountId,
        },
      },
      select: { userId: true },
    });
    if (!existingAccount && linkUserId === undefined) {
      throw new GoogleLoginFailure(
        httpStatus.CONFLICT,
        "Sign in with email and password, then begin Google authorization with your Bearer token to link the account",
        "AUTHENTICATED_LINK_REQUIRED",
      );
    }
    if (
      existingAccount &&
      linkUserId !== undefined &&
      existingAccount.userId !== linkUserId
    ) {
      throw new GoogleLoginFailure(
        httpStatus.CONFLICT,
        "Google account is already linked to another user",
        "PROVIDER_IDENTITY_CONFLICT",
      );
    }
    const userId = existingAccount?.userId ?? linkUserId!;
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const emailOwner = existingAccount
      ? await transaction.user.findUnique({
          where: { email: identity.email },
          select: { id: true },
        })
      : null;
    if (
      existingAccount &&
      emailOwner &&
      emailOwner.id !== existingAccount.userId
    ) {
      throw new GoogleLoginFailure(
        httpStatus.CONFLICT,
        "Google identity conflicts with another user",
        "PROVIDER_IDENTITY_CONFLICT",
      );
    }
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        deletedAt: true,
        emailVerifiedAt: true,
        avatar: true,
      },
    });

    if (!user) {
      throw new GoogleLoginFailure(
        httpStatus.FORBIDDEN,
        "Register an account before connecting Google",
        "ACCOUNT_NOT_REGISTERED",
      );
    }

    if (user.status !== UserStatus.ACTIVE || user.deletedAt) {
      throw new GoogleLoginFailure(
        httpStatus.FORBIDDEN,
        "User account is not active",
        "ACCOUNT_INACTIVE",
      );
    }

    if (linkUserId !== undefined && user.email !== identity.email) {
      throw new GoogleLoginFailure(
        httpStatus.CONFLICT,
        "Google email must match the signed-in account before linking",
        "LINK_EMAIL_MISMATCH",
      );
    }

    const linkedAccount = await transaction.oAuthAccount.upsert({
      where: {
        provider_providerAccountId: {
          provider: identity.provider,
          providerAccountId: identity.providerAccountId,
        },
      },
      create: {
        userId: user.id,
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
      },
      update: {},
      select: { userId: true },
    });

    if (linkedAccount.userId !== user.id) {
      throw new GoogleLoginFailure(
        httpStatus.CONFLICT,
        "Google account is already linked to another user",
        "PROVIDER_IDENTITY_CONFLICT",
      );
    }

    const tokens = createAuthTokens({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    const tokenHash = await hashRefreshToken(tokens.refreshToken);
    await transaction.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash,
        jti: tokens.jti,
        expiresAt: tokens.expiresAt,
      },
    });
    const updatedUser = await transaction.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt:
          user.email === identity.email
            ? (user.emailVerifiedAt ?? new Date())
            : user.emailVerifiedAt,
        avatar: user.avatar ?? identity.avatar,
        lastLoginAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
      },
    });
    await recordAuditEvent(
      {
        actorId: user.id,
        action: existingAccount
          ? "AUTH_GOOGLE_LOGIN_SUCCEEDED"
          : "AUTH_GOOGLE_ACCOUNT_LINKED",
        entityType: "OAuthAccount",
        entityId: googleIdentityAuditId(identity),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: updatedUser,
    };
  });

const loginWithGoogle = async (
  identity: GoogleIdentity,
  context: TRequestContext,
  linkUserId?: number,
) => {
  try {
    return await loginWithGoogleOnce(identity, context, linkUserId);
  } catch (error) {
    if (error instanceof GoogleLoginFailure) {
      await recordGoogleLoginFailure(identity, error.reasonCode, context);
      throw new AppError(error.statusCode, error.message);
    }
    throw error;
  }
};

export const authService = {
  register,
  login,
  refresh,
  logout,
  loginWithGoogle,
};
