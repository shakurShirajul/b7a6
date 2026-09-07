import dotenv from "dotenv";
import ms, { type StringValue } from "ms";
import path from "node:path";
import { z } from "zod";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const jwtExpirationSchema = z
  .string()
  .trim()
  .refine(
    (value) => {
      try {
        return ms(value as StringValue) >= 0;
      } catch {
        return false;
      }
    },
    { message: "must be a duration accepted by jsonwebtoken" },
  )
  .transform((value) => value as StringValue);

const emptyStringAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalTrimmedString = z.preprocess(
  emptyStringAsUndefined,
  z.string().trim().min(1).optional(),
);

const optionalUrl = z.preprocess(emptyStringAsUndefined, z.url().optional());

const boundedTimeout = z.coerce.number().int().min(100).max(60_000);

const corsOriginSchema = z.url().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin === value
      );
    } catch {
      return false;
    }
  },
  { message: "must be an HTTP(S) origin without a path or trailing slash" },
);

const corsOriginsSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(",").map((origin) => origin.trim()))
  .pipe(z.array(corsOriginSchema).min(1))
  .refine((origins) => new Set(origins).size === origins.length, {
    message: "must not contain duplicate origins",
  });

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65_535),
    DATABASE_URL: z.url(),
    DATABASE_CONNECTION_TIMEOUT_MS: boundedTimeout.default(5_000),
    DATABASE_QUERY_TIMEOUT_MS: boundedTimeout.default(15_000),
    DATABASE_TRANSACTION_TIMEOUT_MS: boundedTimeout.default(20_000),
    APP_URL: corsOriginSchema,
    CORS_ORIGINS: corsOriginsSchema,
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(31),
    JWT_ACCESS_TOKEN_SECRET: z.string().trim().min(32),
    JWT_REFRESH_TOKEN_SECRET: z.string().trim().min(32),
    JWT_ACCESS_TOKEN_EXPIRATION: jwtExpirationSchema,
    JWT_REFRESH_TOKEN_EXPIRATION: jwtExpirationSchema,
    GOOGLE_CLIENT_ID: optionalTrimmedString,
    GOOGLE_CLIENT_SECRET: optionalTrimmedString,
    GOOGLE_CALLBACK_URL: optionalUrl,
    GOOGLE_OAUTH_STATE_SECRET: z.preprocess(
      emptyStringAsUndefined,
      z.string().trim().min(32).optional(),
    ),
    REDIS_URL: optionalUrl,
    REDIS_COMMAND_TIMEOUT_MS: boundedTimeout.max(10_000).default(1_500),
    READINESS_TIMEOUT_MS: boundedTimeout.max(10_000).default(1_500),
    READINESS_STARTUP_TIMEOUT_MS: boundedTimeout.default(10_000),
    SMTP_HOST: optionalTrimmedString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_USER: optionalTrimmedString,
    SMTP_PASSWORD: z.preprocess(
      emptyStringAsUndefined,
      z.string().min(1).optional(),
    ),
    EMAIL_FROM: optionalTrimmedString,
    DONOR_MIN_AGE_YEARS: z.coerce.number().int().min(18).max(100).default(18),
    DONOR_MAX_AGE_YEARS: z.coerce.number().int().min(18).max(100).default(65),
    DONOR_MIN_WEIGHT_KG: z.coerce.number().min(1).max(300).default(50),
    DONOR_MIN_DONATION_INTERVAL_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(730)
      .default(120),
    MATCHING_DEFAULT_RADIUS_KM: z.coerce
      .number()
      .positive()
      .max(1_000)
      .default(25),
    MATCHING_EXECUTION_MODE: z.enum(["INLINE", "WORKER"]).default("INLINE"),
    MATCHING_MAX_RADIUS_KM: z.coerce.number().positive().max(1_000).default(50),
    MATCHING_MAX_CANDIDATES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(500),
    MATCHING_MAX_INVITATIONS: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(50),
    DONOR_INVITATION_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_080)
      .default(60),
    EXPIRATION_BATCH_SIZE: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(100),
    STRIPE_SECRET_KEY: z
      .string()
      .trim()
      .regex(
        /^sk_(?:test|live)_\S+$/,
        "must be a Stripe test or live secret key",
      )
      .min(16),
    STRIPE_WEBHOOK_SECRET: z.string().trim().startsWith("whsec_").min(16),
    STRIPE_CURRENCY: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, "must be a three-letter currency code")
      .transform((value) => value.toUpperCase()),
    PAYMENT_MIN_MINOR_UNITS: z.coerce.number().int().positive(),
    PAYMENT_MAX_MINOR_UNITS: z.coerce.number().int().positive().max(99_999_999),
  })
  .refine(
    (environment) =>
      environment.DONOR_MAX_AGE_YEARS >= environment.DONOR_MIN_AGE_YEARS,
    {
      message: "must be greater than or equal to DONOR_MIN_AGE_YEARS",
      path: ["DONOR_MAX_AGE_YEARS"],
    },
  )
  .refine(
    (environment) =>
      environment.MATCHING_MAX_RADIUS_KM >=
      environment.MATCHING_DEFAULT_RADIUS_KM,
    {
      message: "must be greater than or equal to MATCHING_DEFAULT_RADIUS_KM",
      path: ["MATCHING_MAX_RADIUS_KM"],
    },
  )
  .refine(
    (environment) =>
      environment.PAYMENT_MAX_MINOR_UNITS >=
      environment.PAYMENT_MIN_MINOR_UNITS,
    {
      message: "must be greater than or equal to PAYMENT_MIN_MINOR_UNITS",
      path: ["PAYMENT_MAX_MINOR_UNITS"],
    },
  );

const parsedEnvironment = environmentSchema.safeParse(process.env);

if (!parsedEnvironment.success) {
  console.error(
    "Invalid environment configuration:",
    parsedEnvironment.error.flatten().fieldErrors,
  );
  throw new Error("Invalid environment configuration");
}

export const env = parsedEnvironment.data;
