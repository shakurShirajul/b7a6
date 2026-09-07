import { randomBytes } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import httpStatus from "http-status";
import jwt from "jsonwebtoken";
import config from "../../config/index.js";
import { AppError } from "../../errors/AppError.js";

const googleProvider = "google";

export type GoogleIdentity = {
  provider: typeof googleProvider;
  providerAccountId: string;
  email: string;
  name?: string;
  avatar?: string;
};

type GoogleOAuthState = {
  purpose: "google-oauth-state";
  nonce: string;
  linkUserId?: number;
};

type GoogleOAuthSession = {
  purpose: "google-oauth-session";
  nonce: string;
  codeVerifier: string;
  linkUserId?: number;
};

const getGoogleClient = () => {
  if (
    !config.google_client_id ||
    !config.google_client_secret ||
    !config.google_callback_url
  ) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Google authentication is not configured",
    );
  }

  return new OAuth2Client({
    clientId: config.google_client_id,
    clientSecret: config.google_client_secret,
    redirectUri: config.google_callback_url,
  });
};

const verifySignedPayload = <T extends { purpose: string; nonce: string }>(
  token: string,
  purpose: T["purpose"],
) => {
  let decoded: string | jwt.JwtPayload;

  try {
    decoded = jwt.verify(token, config.google_oauth_state_secret, {
      algorithms: ["HS256"],
      audience: "google-oauth",
      issuer: "blood-donation-api",
    });
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid Google OAuth state");
  }

  if (
    typeof decoded === "string" ||
    decoded["purpose"] !== purpose ||
    typeof decoded["nonce"] !== "string"
  ) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid Google OAuth state");
  }

  return decoded as T & jwt.JwtPayload;
};

export const createGoogleAuthorization = async (linkUserId?: number) => {
  const client = getGoogleClient();
  const nonce = randomBytes(32).toString("base64url");
  const { codeVerifier, codeChallenge } =
    await client.generateCodeVerifierAsync();
  const state = jwt.sign(
    {
      purpose: "google-oauth-state",
      nonce,
      linkUserId,
    } satisfies GoogleOAuthState,
    config.google_oauth_state_secret,
    {
      expiresIn: "10m",
      audience: "google-oauth",
      issuer: "blood-donation-api",
    },
  );
  const session = jwt.sign(
    {
      purpose: "google-oauth-session",
      nonce,
      codeVerifier,
      linkUserId,
    } satisfies GoogleOAuthSession,
    config.google_oauth_state_secret,
    {
      expiresIn: "10m",
      audience: "google-oauth",
      issuer: "blood-donation-api",
    },
  );

  return {
    session,
    authorizationUrl: client.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      include_granted_scopes: true,
      prompt: "select_account",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    }),
  };
};

export const verifyGoogleCallback = async (
  code: string,
  stateToken: string,
  sessionToken: string,
) => {
  const state = verifySignedPayload<GoogleOAuthState>(
    stateToken,
    "google-oauth-state",
  );
  const session = verifySignedPayload<GoogleOAuthSession>(
    sessionToken,
    "google-oauth-session",
  );

  if (
    state.nonce !== session.nonce ||
    state.linkUserId !== session.linkUserId ||
    (session.linkUserId !== undefined &&
      (!Number.isSafeInteger(session.linkUserId) || session.linkUserId <= 0))
  ) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid Google OAuth state");
  }

  if (typeof session.codeVerifier !== "string" || !session.codeVerifier) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid Google OAuth state");
  }

  const client = getGoogleClient();
  let idToken: string | null | undefined;

  try {
    const tokenResponse = await client.getToken({
      code,
      codeVerifier: session.codeVerifier,
    });
    idToken = tokenResponse.tokens.id_token;
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, "Google login failed");
  }

  if (!idToken || !config.google_client_id) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Google identity is missing");
  }

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: config.google_client_id,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(httpStatus.UNAUTHORIZED, "Google identity is invalid");
  }

  if (
    !payload?.sub ||
    !payload.email ||
    payload.email_verified !== true ||
    payload.nonce !== state.nonce
  ) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      "Google did not return a verified identity",
    );
  }

  const identity = {
    provider: googleProvider,
    providerAccountId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    name: payload.name?.trim(),
    avatar: payload.picture,
  } satisfies GoogleIdentity;
  return { identity, linkUserId: session.linkUserId };
};
