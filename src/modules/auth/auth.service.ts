import bcrypt from "bcryptjs";
import { AppError } from "../../errors/AppError";
import { prisma } from "../../lib/prisma";
import { TJwtPayload, TLoginPayload } from "./auth.interface";
import httpStatus from "http-status";
import { SignOptions } from "jsonwebtoken";
import jwt from "jsonwebtoken";
import config from "../../config";

const getRefreshTokenExpiresAt = () => {
  const expiresIn = config.jwt_refresh_expires_in || "30d";
  const value = Number.parseInt(expiresIn, 10);
  const unit = expiresIn.replace(String(value), "");

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  const multiplier = multipliers[unit] || multipliers.d;
  const duration = Number.isNaN(value)
    ? 30 * multipliers.d
    : value * multiplier;

  return new Date(Date.now() + duration);
};

const createToken = (
  payload: TJwtPayload,
  secrect: string,
  expiresIn: string,
) => {
  const options: SignOptions = {
    expiresIn: expiresIn as SignOptions["expiresIn"],
  };
  return jwt.sign(payload, secrect, options);
};

const createAuthTokens = (payload: TJwtPayload) => {
  const accessToken = createToken(
    payload,
    config.jwt_access_secret,
    config.jwt_access_expires_in,
  );
  const refreshToken = createToken(
    payload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in,
  );

  return {
    accessToken,
    refreshToken,
  };
};

const saveRefreshToken = async (userId: number, refreshToken: string) => {
  const refreshTokenHash = await bcrypt.hash(
    refreshToken,
    Number(config.bcrypt_salt_rounds),
  );

  await prisma.user.update({
    where: {
      id: userId,
    },
    data: {
      refreshTokenHash,
      refreshTokenExpiresAt: getRefreshTokenExpiresAt(),
    },
  });
};

const loginUser = async (payload: TLoginPayload) => {
  const { email, password } = payload;
  const user = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!user) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid email or password");
  }

  if (user.status !== "ACTIVE") {
    throw new AppError(httpStatus.FORBIDDEN, "User is not active");
  }

  const isPasswordMatched = await bcrypt.compare(password, user.password);

  if (!isPasswordMatched) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid email or password");
  }

  const tokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const tokens = createAuthTokens(tokenPayload);
  await saveRefreshToken(user.id, tokens.refreshToken);

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

const logoutUser = async (token: string) => {
  try {
    const decoded = jwt.verify(token, config.jwt_refresh_secret) as TJwtPayload;
    await prisma.user.update({
      where: {
        id: decoded.userId,
      },
      data: {
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
      },
    });
  } catch (error) {}
};

const refreshToken = async (token: string) => {
    let decoded: TJwtPayload;

    try {
        decoded = jwt.verify(token, config.jwt_refresh_secret) as TJwtPayload;
    } catch {
        throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
    }

    const user = await prisma.user.findUnique({
        where: {
            id: decoded.userId,
        },
    });

    if (!user || !user.refreshTokenHash || !user.refreshTokenExpiresAt) {
        throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
    }

    if (user.status !== "ACTIVE") {
        throw new AppError(httpStatus.FORBIDDEN, "User account is not active");
    }

    if (user.refreshTokenExpiresAt < new Date()) {
        throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token expired");
    }

    const isTokenMatched = await bcrypt.compare(token, user.refreshTokenHash);

    if (!isTokenMatched) {
        throw new AppError(httpStatus.UNAUTHORIZED, "Invalid refresh token");
    }

    const tokenPayload: TJwtPayload = {
        userId: user.id,
        email: user.email,
        role: user.role,
    };

    const tokens = createAuthTokens(tokenPayload);

    await saveRefreshToken(user.id, tokens.refreshToken);

    return tokens;
};

export const authService = {
  loginUser,
  logoutUser,
  refreshToken,
};
