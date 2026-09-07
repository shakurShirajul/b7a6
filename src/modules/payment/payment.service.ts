import { randomUUID } from "node:crypto";
import httpStatus from "http-status";
import Stripe from "stripe";
import config from "../../config/index.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  BloodRequestStatus,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
  Role,
} from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { recordAuditEvent } from "../../shared/audit.js";
import { invalidateDashboardCache } from "../../shared/dashboard-cache.js";
import type {
  CreateCheckoutPayload,
  CurrentPaymentUser,
  PaymentListQuery,
  PaymentRequestContext,
} from "./payment.interface.js";

const stripe = new Stripe(config.stripe.secret_key, {
  apiVersion: "2026-08-26.dahlia",
  maxNetworkRetries: 2,
  timeout: 10_000,
});

const webhookTransactionAttempts = 3;
const webhookContentionCodes = new Set(["P2002", "P2034"]);
const publicRequestStatuses = [
  BloodRequestStatus.VERIFIED,
  BloodRequestStatus.MATCHING,
  BloodRequestStatus.PARTIALLY_FULFILLED,
] as const;

const zeroDecimalCurrencies = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const threeDecimalCurrencies = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);
const integerOnlyTwoDecimalCurrencies = new Set(["ISK", "UGX"]);

const handledWebhookTypes = new Set([
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
]);

export const isHandledPaymentWebhookType = (eventType: string) =>
  handledWebhookTypes.has(eventType);

const paymentSelect = {
  id: true,
  payerId: true,
  bloodRequestId: true,
  purpose: true,
  amount: true,
  currency: true,
  checkoutSessionId: true,
  paymentIntentId: true,
  refundId: true,
  refundStatus: true,
  status: true,
  checkoutCompletedAt: true,
  refundRequestedAt: true,
  paidAt: true,
  refundedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PaymentSelect;

const internalPaymentSelect = {
  ...paymentSelect,
  idempotencyKey: true,
} satisfies Prisma.PaymentSelect;

type InternalPayment = Prisma.PaymentGetPayload<{
  select: typeof internalPaymentSelect;
}>;

type RefundEvidence = {
  id: string;
  amount: number;
  currency: string;
  paymentIntentId: string | null;
  metadataPaymentId: string | null;
  status: string | null;
};

type WebhookEvidence = {
  metadataPaymentId: string | null;
  objectId: string;
  objectType: "checkout.session" | "payment_intent" | "charge" | "refund";
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  refundId: string | null;
  refundStatus: string | null;
  refundCandidates: RefundEvidence[];
  currency: string | null;
  amountTotal: number | null;
  amount: number | null;
  amountReceived: number | null;
  amountRefunded: number | null;
  checkoutMode: string | null;
  checkoutStatus: string | null;
  paymentStatus: string | null;
  chargePaid: boolean | null;
  chargeRefunded: boolean | null;
  targetStatus: PaymentStatus | null;
  checkoutCompletedAt: Date | null;
  refundRequestedAt: Date | null;
  paidAt: Date | null;
  refundedAt: Date | null;
};

const expandableId = (value: string | { id: string } | null): string | null =>
  typeof value === "string" ? value : (value?.id ?? null);

export const hasMatchingPaymentIntentIds = (
  storedPaymentIntentId: string | null,
  incomingPaymentIntentId: string | null,
) =>
  typeof storedPaymentIntentId === "string" &&
  storedPaymentIntentId.length > 0 &&
  typeof incomingPaymentIntentId === "string" &&
  incomingPaymentIntentId.length > 0 &&
  incomingPaymentIntentId === storedPaymentIntentId;

const paymentAuditProjection = (payment: {
  id: number;
  payerId: number;
  bloodRequestId: number | null;
  purpose: PaymentPurpose;
  amount: number;
  currency: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  refundId: string | null;
  refundStatus: string | null;
  status: PaymentStatus;
  checkoutCompletedAt: Date | null;
  refundRequestedAt: Date | null;
  paidAt: Date | null;
  refundedAt: Date | null;
}) => ({
  id: payment.id,
  payerId: payment.payerId,
  bloodRequestId: payment.bloodRequestId,
  purpose: payment.purpose,
  amount: payment.amount,
  currency: payment.currency,
  checkoutSessionId: payment.checkoutSessionId,
  paymentIntentId: payment.paymentIntentId,
  refundId: payment.refundId,
  refundStatus: payment.refundStatus,
  status: payment.status,
  checkoutCompletedAt: payment.checkoutCompletedAt?.toISOString() ?? null,
  refundRequestedAt: payment.refundRequestedAt?.toISOString() ?? null,
  paidAt: payment.paidAt?.toISOString() ?? null,
  refundedAt: payment.refundedAt?.toISOString() ?? null,
});

const currencyExponent = (currency: string) => {
  if (zeroDecimalCurrencies.has(currency)) return 0;
  if (threeDecimalCurrencies.has(currency)) return 3;
  return 2;
};

export const convertMajorAmountToMinorUnits = (
  majorAmount: string,
  currency: string,
) => {
  const normalizedCurrency = currency.trim().toUpperCase();
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(majorAmount);
  if (!match) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Amount must be a positive decimal value",
    );
  }

  const [wholePart = "0", fractionalPart = ""] = majorAmount.split(".");
  const exponent = currencyExponent(normalizedCurrency);
  if (fractionalPart.length > exponent) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Amount has too many decimal places for ${normalizedCurrency}`,
    );
  }
  if (
    integerOnlyTwoDecimalCurrencies.has(normalizedCurrency) &&
    fractionalPart.replace(/0/g, "").length > 0
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `${normalizedCurrency} amounts must be whole currency units`,
    );
  }

  const scale = 10n ** BigInt(exponent);
  const fraction = fractionalPart.padEnd(exponent, "0") || "0";
  const minorUnits = BigInt(wholePart) * scale + BigInt(fraction);
  if (
    minorUnits < BigInt(config.stripe.payment_min_minor_units) ||
    minorUnits > BigInt(config.stripe.payment_max_minor_units)
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Amount must be between ${config.stripe.payment_min_minor_units} and ${config.stripe.payment_max_minor_units} minor units`,
    );
  }
  if (minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(httpStatus.BAD_REQUEST, "Amount is too large");
  }
  return Number(minorUnits);
};

const assertConfiguredCurrency = (currency: string) => {
  if (currency !== config.stripe.currency) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Currency must be ${config.stripe.currency}`,
    );
  }
};

const assertVisibleRequestLink = async (
  user: CurrentPaymentUser,
  bloodRequestId: number | undefined,
) => {
  if (!bloodRequestId) return;

  const roleVisibility: Prisma.BloodRequestWhereInput =
    user.role === Role.PATIENT
      ? {
          OR: [
            { patient: { userId: user.userId } },
            { status: { in: [...publicRequestStatuses] } },
          ],
        }
      : {
          OR: [
            { status: { in: [...publicRequestStatuses] } },
            {
              assignments: {
                some: { donor: { userId: user.userId } },
              },
            },
          ],
        };

  const linkedRequest = await prisma.bloodRequest.findFirst({
    where: {
      AND: [{ id: bloodRequestId, deletedAt: null }, roleVisibility],
    },
    select: { id: true },
  });
  if (!linkedRequest) {
    throw new AppError(httpStatus.NOT_FOUND, "Visible blood request not found");
  }
};

const createPaymentNotification = async (
  transaction: Prisma.TransactionClient,
  payment: { id: number; payerId: number; status: PaymentStatus },
  deduplicationSuffix: string,
  message = `Your contribution payment is now ${payment.status.toLowerCase()}.`,
) => {
  const notification = await transaction.notification.create({
    data: {
      userId: payment.payerId,
      title: "Payment status updated",
      message,
      type: NotificationType.PAYMENT_UPDATED,
      deduplicationKey: `payment:${payment.id}:${deduplicationSuffix}`,
    },
    select: { id: true },
  });
  await transaction.outboxEvent.create({
    data: {
      type: "SEND_NOTIFICATION_EMAIL",
      aggregateId: String(notification.id),
      deduplicationKey: `email-notification:${notification.id}`,
      payload: { notificationId: notification.id },
    },
  });
};

const recordProviderFailure = async (
  paymentId: number,
  actorId: number | undefined,
  action: string,
  reasonCode: string,
  context: PaymentRequestContext,
) => {
  try {
    await recordAuditEvent({
      actorId,
      action,
      entityType: "Payment",
      entityId: String(paymentId),
      after: { reasonCode },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  } catch {
    console.error("Payment provider failure audit was deferred", {
      paymentId,
      action,
    });
  }
};

const markCheckoutCreationFailed = async (
  paymentId: number,
  actorId: number,
  context: PaymentRequestContext,
) => {
  await prisma.$transaction(async (transaction) => {
    const payment = await transaction.payment.findUnique({
      where: { id: paymentId },
      select: internalPaymentSelect,
    });
    if (!payment || payment.status !== PaymentStatus.INITIATED) return;

    const updated = await transaction.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.FAILED },
      select: internalPaymentSelect,
    });
    await recordAuditEvent(
      {
        actorId,
        action: "PAYMENT_CHECKOUT_CREATION_FAILED",
        entityType: "Payment",
        entityId: String(payment.id),
        before: paymentAuditProjection(payment),
        after: paymentAuditProjection(updated),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
    await createPaymentNotification(
      transaction,
      updated,
      "checkout-creation-failed",
    );
  });
};

const assertCheckoutSessionEvidence = (
  session: Stripe.Checkout.Session,
  payment: Pick<
    InternalPayment,
    "id" | "amount" | "currency" | "checkoutSessionId"
  >,
  expectedStatus: "open" | "expired",
) => {
  if (
    session.id !== (payment.checkoutSessionId ?? session.id) ||
    session.mode !== "payment" ||
    session.status !== expectedStatus ||
    session.amount_total !== payment.amount ||
    session.currency?.toUpperCase() !== payment.currency ||
    session.metadata?.paymentId !== String(payment.id)
  ) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Stripe returned inconsistent Checkout Session data",
    );
  }
};

const paymentProductName = (purpose: PaymentPurpose) =>
  purpose === PaymentPurpose.EMERGENCY_SUPPORT
    ? "Emergency support contribution"
    : "Platform support contribution";

const checkoutReturnUrl = (path: string) =>
  new URL(path, config.app_url).toString();

const createCheckoutSession = async (
  user: CurrentPaymentUser,
  payload: CreateCheckoutPayload,
  context: PaymentRequestContext,
) => {
  assertConfiguredCurrency(payload.currency);
  const amount = convertMajorAmountToMinorUnits(
    payload.amount,
    payload.currency,
  );
  await assertVisibleRequestLink(user, payload.bloodRequestId);

  const initiatedPayment = await prisma.$transaction(async (transaction) => {
    const payment = await transaction.payment.create({
      data: {
        payerId: user.userId,
        bloodRequestId: payload.bloodRequestId,
        purpose: payload.purpose,
        amount,
        currency: config.stripe.currency,
        idempotencyKey: randomUUID(),
        status: PaymentStatus.INITIATED,
      },
      select: internalPaymentSelect,
    });
    await recordAuditEvent(
      {
        actorId: user.userId,
        action: "PAYMENT_INITIATED",
        entityType: "Payment",
        entityId: String(payment.id),
        after: paymentAuditProjection(payment),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );
    return payment;
  });
  await invalidateDashboardCache();

  let checkoutSession: Stripe.Checkout.Session;
  try {
    checkoutSession = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        success_url: checkoutReturnUrl("/payments/success"),
        cancel_url: checkoutReturnUrl("/payments/cancel"),
        submit_type: "donate",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: initiatedPayment.currency.toLowerCase(),
              unit_amount: initiatedPayment.amount,
              product_data: {
                name: paymentProductName(initiatedPayment.purpose),
              },
            },
          },
        ],
        metadata: { paymentId: String(initiatedPayment.id) },
        payment_intent_data: {
          metadata: { paymentId: String(initiatedPayment.id) },
        },
      },
      { idempotencyKey: initiatedPayment.idempotencyKey },
    );
    assertCheckoutSessionEvidence(checkoutSession, initiatedPayment, "open");
    if (!checkoutSession.url) {
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        "Stripe did not return a Checkout URL",
      );
    }
  } catch {
    console.error("Stripe Checkout Session creation failed", {
      paymentId: initiatedPayment.id,
    });
    await markCheckoutCreationFailed(initiatedPayment.id, user.userId, context);
    await invalidateDashboardCache();
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Payment provider could not create a Checkout Session",
    );
  }

  const payment = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Payment" WHERE "id" = ${initiatedPayment.id} FOR UPDATE
    `;
    const beforeUpdate = await transaction.payment.findUniqueOrThrow({
      where: { id: initiatedPayment.id },
      select: internalPaymentSelect,
    });
    if (
      beforeUpdate.checkoutSessionId &&
      beforeUpdate.checkoutSessionId !== checkoutSession.id
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Payment state changed while Checkout was being created",
      );
    }
    const current = !beforeUpdate.checkoutSessionId
      ? await transaction.payment.update({
          where: { id: beforeUpdate.id },
          data: {
            checkoutSessionId: checkoutSession.id,
            status:
              beforeUpdate.status === PaymentStatus.INITIATED
                ? PaymentStatus.OPEN
                : beforeUpdate.status,
          },
          select: internalPaymentSelect,
        })
      : beforeUpdate;
    if (current !== beforeUpdate) {
      await recordAuditEvent(
        {
          actorId: user.userId,
          action: "PAYMENT_CHECKOUT_OPENED",
          entityType: "Payment",
          entityId: String(current.id),
          before: paymentAuditProjection(beforeUpdate),
          after: paymentAuditProjection(current),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );
    }
    return transaction.payment.findUniqueOrThrow({
      where: { id: current.id },
      select: paymentSelect,
    });
  });

  await invalidateDashboardCache();
  return { payment, checkoutUrl: checkoutSession.url };
};

const extractSessionEvidence = (
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
): WebhookEvidence => {
  const targetStatus =
    event.type === "checkout.session.expired"
      ? PaymentStatus.EXPIRED
      : event.type === "checkout.session.async_payment_failed"
        ? PaymentStatus.FAILED
        : session.payment_status === "paid"
          ? PaymentStatus.PAID
          : PaymentStatus.OPEN;
  const providerTime = new Date(event.created * 1_000);
  return {
    metadataPaymentId: session.metadata?.paymentId ?? null,
    objectId: session.id,
    objectType: "checkout.session",
    checkoutSessionId: session.id,
    paymentIntentId: expandableId(session.payment_intent),
    refundId: null,
    refundStatus: null,
    refundCandidates: [],
    currency: session.currency,
    amountTotal: session.amount_total,
    amount: null,
    amountReceived: null,
    amountRefunded: null,
    checkoutMode: session.mode,
    checkoutStatus: session.status,
    paymentStatus: session.payment_status,
    chargePaid: null,
    chargeRefunded: null,
    targetStatus,
    checkoutCompletedAt:
      event.type === "checkout.session.expired" ? null : providerTime,
    refundRequestedAt: null,
    paidAt: targetStatus === PaymentStatus.PAID ? providerTime : null,
    refundedAt: null,
  };
};

export const refundStatusTargetPaymentStatus = (refundStatus: string | null) =>
  refundStatus === "succeeded" ? PaymentStatus.REFUNDED : null;

const recognizedProviderRefundStatuses = new Set([
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
]);

export const isRecognizedProviderRefundStatus = (status: string | null) =>
  status !== null && recognizedProviderRefundStatuses.has(status);

const extractWebhookEvidence = (event: Stripe.Event): WebhookEvidence => {
  if (event.type.startsWith("checkout.session.")) {
    return extractSessionEvidence(
      event,
      event.data.object as Stripe.Checkout.Session,
    );
  }
  if (event.type.startsWith("payment_intent.")) {
    const intent = event.data.object as Stripe.PaymentIntent;
    const paid = event.type === "payment_intent.succeeded";
    return {
      metadataPaymentId: intent.metadata?.paymentId ?? null,
      objectId: intent.id,
      objectType: "payment_intent",
      checkoutSessionId: null,
      paymentIntentId: intent.id,
      refundId: null,
      refundStatus: null,
      refundCandidates: [],
      currency: intent.currency,
      amountTotal: null,
      amount: intent.amount,
      amountReceived: intent.amount_received,
      amountRefunded: null,
      checkoutMode: null,
      checkoutStatus: null,
      paymentStatus: intent.status,
      chargePaid: null,
      chargeRefunded: null,
      targetStatus: paid ? PaymentStatus.PAID : PaymentStatus.FAILED,
      checkoutCompletedAt: null,
      refundRequestedAt: null,
      paidAt: paid ? new Date(event.created * 1_000) : null,
      refundedAt: null,
    };
  }

  if (event.type.startsWith("refund.")) {
    const refund = event.data.object as Stripe.Refund;
    const targetStatus = refundStatusTargetPaymentStatus(refund.status);
    return {
      metadataPaymentId: refund.metadata?.paymentId ?? null,
      objectId: refund.id,
      objectType: "refund",
      checkoutSessionId: null,
      paymentIntentId: expandableId(refund.payment_intent),
      refundId: refund.id,
      refundStatus: refund.status,
      refundCandidates: [],
      currency: refund.currency,
      amountTotal: null,
      amount: refund.amount,
      amountReceived: null,
      amountRefunded: null,
      checkoutMode: null,
      checkoutStatus: null,
      paymentStatus: null,
      chargePaid: null,
      chargeRefunded: null,
      targetStatus,
      checkoutCompletedAt: null,
      refundRequestedAt: new Date(refund.created * 1_000),
      paidAt: null,
      refundedAt:
        targetStatus === PaymentStatus.REFUNDED
          ? new Date(event.created * 1_000)
          : null,
    };
  }

  const charge = event.data.object as Stripe.Charge;
  const refundCandidates = (charge.refunds?.data ?? []).map((refund) => ({
    id: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    paymentIntentId: expandableId(refund.payment_intent),
    metadataPaymentId: refund.metadata?.paymentId ?? null,
    status: refund.status,
  }));
  return {
    metadataPaymentId: charge.metadata?.paymentId ?? null,
    objectId: charge.id,
    objectType: "charge",
    checkoutSessionId: null,
    paymentIntentId: expandableId(charge.payment_intent),
    refundId: null,
    refundStatus: null,
    refundCandidates,
    currency: charge.currency,
    amountTotal: null,
    amount: charge.amount,
    amountReceived: charge.amount,
    amountRefunded: charge.amount_refunded,
    checkoutMode: null,
    checkoutStatus: null,
    paymentStatus: charge.status,
    chargePaid: charge.paid,
    chargeRefunded: charge.refunded,
    targetStatus: PaymentStatus.REFUNDED,
    checkoutCompletedAt: null,
    refundRequestedAt: null,
    paidAt: new Date(charge.created * 1_000),
    refundedAt: new Date(event.created * 1_000),
  };
};

const parseMetadataPaymentId = (rawPaymentId: string | null) => {
  if (!rawPaymentId || !/^[1-9]\d*$/.test(rawPaymentId)) return null;
  const paymentId = Number(rawPaymentId);
  return Number.isSafeInteger(paymentId) ? paymentId : null;
};

const sanitizedEventPayload = (
  event: Stripe.Event,
  evidence: WebhookEvidence,
): Prisma.InputJsonValue => ({
  eventId: event.id,
  type: event.type,
  created: event.created,
  livemode: event.livemode,
  providerObject: {
    id: evidence.objectId,
    object: evidence.objectType,
    metadataPaymentId: evidence.metadataPaymentId,
    checkoutSessionId: evidence.checkoutSessionId,
    paymentIntentId: evidence.paymentIntentId,
    refundId: evidence.refundId,
    refundStatus: evidence.refundStatus,
    refundCandidates: evidence.refundCandidates,
    currency: evidence.currency,
    amountTotal: evidence.amountTotal,
    amount: evidence.amount,
    amountReceived: evidence.amountReceived,
    amountRefunded: evidence.amountRefunded,
    checkoutMode: evidence.checkoutMode,
    checkoutStatus: evidence.checkoutStatus,
    paymentStatus: evidence.paymentStatus,
    chargePaid: evidence.chargePaid,
    chargeRefunded: evidence.chargeRefunded,
    checkoutCompletedAt: evidence.checkoutCompletedAt?.toISOString() ?? null,
    refundRequestedAt: evidence.refundRequestedAt?.toISOString() ?? null,
  },
});

const correlatedChargeRefund = (
  evidence: WebhookEvidence,
  payment: InternalPayment,
) =>
  payment.refundId
    ? (evidence.refundCandidates.find(
        (candidate) => candidate.id === payment.refundId,
      ) ?? null)
    : null;

const evidenceValidationError = (
  eventType: string,
  evidence: WebhookEvidence,
  payment: InternalPayment,
) => {
  if (evidence.metadataPaymentId !== String(payment.id)) {
    return "METADATA_PAYMENT_ID_MISMATCH";
  }
  if (
    evidence.checkoutSessionId &&
    payment.checkoutSessionId &&
    evidence.checkoutSessionId !== payment.checkoutSessionId
  ) {
    return "CHECKOUT_SESSION_ID_MISMATCH";
  }
  if (
    evidence.paymentIntentId &&
    payment.paymentIntentId &&
    evidence.paymentIntentId !== payment.paymentIntentId
  ) {
    return "PAYMENT_INTENT_ID_MISMATCH";
  }
  if (evidence.currency?.toUpperCase() !== payment.currency) {
    return "CURRENCY_MISMATCH";
  }

  if (evidence.objectType === "checkout.session") {
    if (evidence.amountTotal !== payment.amount) return "AMOUNT_TOTAL_MISMATCH";
    if (evidence.checkoutMode !== "payment") return "CHECKOUT_MODE_MISMATCH";
    if (
      eventType === "checkout.session.expired" &&
      (evidence.checkoutStatus !== "expired" ||
        evidence.paymentStatus === "paid")
    ) {
      return "CHECKOUT_STATUS_MISMATCH";
    }
    if (
      eventType !== "checkout.session.expired" &&
      evidence.checkoutStatus !== "complete"
    ) {
      return "CHECKOUT_STATUS_MISMATCH";
    }
    if (
      (eventType === "checkout.session.async_payment_succeeded" ||
        evidence.targetStatus === PaymentStatus.PAID) &&
      (evidence.paymentStatus !== "paid" || !evidence.paymentIntentId)
    ) {
      return "PAYMENT_CONFIRMATION_MISMATCH";
    }
    if (
      eventType === "checkout.session.async_payment_failed" &&
      evidence.paymentStatus === "paid"
    ) {
      return "PAYMENT_FAILURE_STATE_MISMATCH";
    }
  }

  if (evidence.objectType === "payment_intent") {
    if (evidence.amount !== payment.amount) return "AMOUNT_MISMATCH";
    const expectedAmountReceived =
      eventType === "payment_intent.succeeded" ? payment.amount : 0;
    if (evidence.amountReceived !== expectedAmountReceived) {
      return "AMOUNT_RECEIVED_MISMATCH";
    }
    if (
      eventType === "payment_intent.succeeded" &&
      evidence.paymentStatus !== "succeeded"
    ) {
      return "PAYMENT_CONFIRMATION_MISMATCH";
    }
    if (!evidence.paymentIntentId) return "PAYMENT_INTENT_ID_MISSING";
  }

  if (evidence.objectType === "charge") {
    if (
      !hasMatchingPaymentIntentIds(
        payment.paymentIntentId,
        evidence.paymentIntentId,
      )
    ) {
      return "CHARGE_PAYMENT_INTENT_ID_MISMATCH";
    }
    if (!payment.refundId) return "REFUND_ID_NOT_LINKED";
    const refund = correlatedChargeRefund(evidence, payment);
    if (!refund) return "CORRELATED_REFUND_NOT_INCLUDED";
    if (evidence.amount !== payment.amount) return "CHARGE_AMOUNT_MISMATCH";
    if (evidence.amountReceived !== payment.amount) {
      return "AMOUNT_RECEIVED_MISMATCH";
    }
    if (evidence.amountRefunded !== payment.amount) {
      return "FULL_REFUND_AMOUNT_MISMATCH";
    }
    if (!evidence.chargePaid || !evidence.chargeRefunded) {
      return "REFUND_STATE_MISMATCH";
    }
    if (refund.amount !== payment.amount) return "FULL_REFUND_AMOUNT_MISMATCH";
    if (refund.currency.toUpperCase() !== payment.currency) {
      return "REFUND_CURRENCY_MISMATCH";
    }
    if (
      !hasMatchingPaymentIntentIds(
        payment.paymentIntentId,
        refund.paymentIntentId,
      )
    ) {
      return "REFUND_PAYMENT_INTENT_ID_MISMATCH";
    }
    if (refund.metadataPaymentId !== String(payment.id)) {
      return "REFUND_METADATA_PAYMENT_ID_MISMATCH";
    }
    if (refund.status !== "succeeded") return "REFUND_NOT_SUCCEEDED";
  }

  if (evidence.objectType === "refund") {
    if (
      payment.refundId &&
      evidence.refundId &&
      evidence.refundId !== payment.refundId
    ) {
      return "REFUND_ID_MISMATCH";
    }
    if (!evidence.refundId) return "REFUND_ID_MISSING";
    if (evidence.amount !== payment.amount)
      return "FULL_REFUND_AMOUNT_MISMATCH";
    if (
      !hasMatchingPaymentIntentIds(
        payment.paymentIntentId,
        evidence.paymentIntentId,
      )
    ) {
      return "REFUND_PAYMENT_INTENT_ID_MISMATCH";
    }
    if (!isRecognizedProviderRefundStatus(evidence.refundStatus)) {
      return "REFUND_STATUS_INVALID";
    }
    if (eventType === "refund.failed" && evidence.refundStatus !== "failed") {
      return "REFUND_FAILURE_STATE_MISMATCH";
    }
    if (
      evidence.targetStatus === PaymentStatus.REFUNDED &&
      evidence.refundStatus !== "succeeded"
    ) {
      return "REFUND_NOT_SUCCEEDED";
    }
  }

  return null;
};

const paymentStateRank: Record<PaymentStatus, number> = {
  [PaymentStatus.INITIATED]: 0,
  [PaymentStatus.OPEN]: 1,
  [PaymentStatus.FAILED]: 2,
  [PaymentStatus.CANCELLED]: 2,
  [PaymentStatus.EXPIRED]: 2,
  [PaymentStatus.PAID]: 3,
  [PaymentStatus.REFUNDED]: 4,
};

export const resolveWebhookPaymentStatus = (
  current: PaymentStatus,
  target: PaymentStatus,
) => (paymentStateRank[target] > paymentStateRank[current] ? target : current);

export const stripeEventMatchesConfiguredMode = (livemode: boolean) =>
  livemode === config.stripe.livemode;

const terminalRefundStatuses = new Set(["succeeded", "failed", "canceled"]);

export const resolveProviderRefundStatus = (
  current: string | null,
  incoming: string | null,
) => {
  if (!incoming) return current;
  if (current && terminalRefundStatuses.has(current)) return current;
  return incoming;
};

const rejectStoredWebhookEvent = async (
  transaction: Prisma.TransactionClient,
  paymentEventId: number,
  paymentId: number | null,
  reasonCode: string,
  stripeEventId: string,
  eventType: string,
) => {
  await transaction.paymentEvent.update({
    where: { id: paymentEventId },
    data: {
      paymentId,
      processedAt: new Date(),
      processingError: reasonCode,
    },
  });
  await recordAuditEvent(
    {
      action: "PAYMENT_WEBHOOK_REJECTED",
      entityType: "PaymentEvent",
      entityId: String(paymentEventId),
      after: { paymentId, stripeEventId, eventType, reasonCode },
    },
    transaction,
  );
};

const processWebhookEventOnce = async (
  event: Stripe.Event,
  evidence: WebhookEvidence,
) =>
  prisma.$transaction(
    async (transaction) => {
      const storedEvent = await transaction.paymentEvent.create({
        data: {
          stripeEventId: event.id,
          type: event.type,
          payload: sanitizedEventPayload(event, evidence),
        },
        select: { id: true },
      });
      if (!stripeEventMatchesConfiguredMode(event.livemode)) {
        await rejectStoredWebhookEvent(
          transaction,
          storedEvent.id,
          null,
          "STRIPE_LIVEMODE_MISMATCH",
          event.id,
          event.type,
        );
        return { handled: true, duplicate: false, applied: false };
      }
      const paymentId = parseMetadataPaymentId(evidence.metadataPaymentId);
      if (!paymentId) {
        await rejectStoredWebhookEvent(
          transaction,
          storedEvent.id,
          null,
          "INVALID_OR_MISSING_METADATA_PAYMENT_ID",
          event.id,
          event.type,
        );
        return { handled: true, duplicate: false, applied: false };
      }

      const lockedRows = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE
      `;
      if (lockedRows.length !== 1) {
        await rejectStoredWebhookEvent(
          transaction,
          storedEvent.id,
          null,
          "PAYMENT_NOT_FOUND",
          event.id,
          event.type,
        );
        return { handled: true, duplicate: false, applied: false };
      }

      const payment = await transaction.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: internalPaymentSelect,
      });
      const validationError = evidenceValidationError(
        event.type,
        evidence,
        payment,
      );
      if (validationError) {
        await rejectStoredWebhookEvent(
          transaction,
          storedEvent.id,
          payment.id,
          validationError,
          event.id,
          event.type,
        );
        return { handled: true, duplicate: false, applied: false };
      }

      const identifierCollision = await transaction.payment.findFirst({
        where: {
          id: { not: payment.id },
          OR: [
            ...(evidence.checkoutSessionId
              ? [{ checkoutSessionId: evidence.checkoutSessionId }]
              : []),
            ...(evidence.paymentIntentId
              ? [{ paymentIntentId: evidence.paymentIntentId }]
              : []),
            ...(evidence.refundId ? [{ refundId: evidence.refundId }] : []),
          ],
        },
        select: { id: true },
      });
      if (identifierCollision) {
        await rejectStoredWebhookEvent(
          transaction,
          storedEvent.id,
          payment.id,
          "PROVIDER_IDENTIFIER_ALREADY_LINKED",
          event.id,
          event.type,
        );
        return { handled: true, duplicate: false, applied: false };
      }

      const nextStatus = evidence.targetStatus
        ? resolveWebhookPaymentStatus(payment.status, evidence.targetStatus)
        : payment.status;
      const statusChanged = nextStatus !== payment.status;
      const ignoredRegression =
        evidence.targetStatus !== null &&
        !statusChanged &&
        evidence.targetStatus !== payment.status;
      const chargeRefund = correlatedChargeRefund(evidence, payment);
      const incomingRefundId = evidence.refundId ?? chargeRefund?.id ?? null;
      const incomingRefundStatus = resolveProviderRefundStatus(
        payment.refundStatus,
        evidence.refundStatus ?? chargeRefund?.status ?? null,
      );
      const needsIdentifierUpdate =
        (!payment.checkoutSessionId && Boolean(evidence.checkoutSessionId)) ||
        (!payment.paymentIntentId && Boolean(evidence.paymentIntentId)) ||
        (!payment.refundId && Boolean(incomingRefundId));
      const needsRefundStatusUpdate =
        Boolean(incomingRefundStatus) &&
        incomingRefundStatus !== payment.refundStatus;
      const needsCheckoutCompletedAt =
        !ignoredRegression &&
        !payment.checkoutCompletedAt &&
        Boolean(evidence.checkoutCompletedAt);
      const needsRefundRequestedAt =
        !payment.refundRequestedAt && Boolean(evidence.refundRequestedAt);
      const needsPaidAt =
        (nextStatus === PaymentStatus.PAID ||
          nextStatus === PaymentStatus.REFUNDED) &&
        !payment.paidAt &&
        Boolean(evidence.paidAt);
      const needsRefundedAt =
        nextStatus === PaymentStatus.REFUNDED &&
        !payment.refundedAt &&
        Boolean(evidence.refundedAt);

      const updated =
        statusChanged ||
        needsIdentifierUpdate ||
        needsRefundStatusUpdate ||
        needsCheckoutCompletedAt ||
        needsRefundRequestedAt ||
        needsPaidAt ||
        needsRefundedAt
          ? await transaction.payment.update({
              where: { id: payment.id },
              data: {
                status: nextStatus,
                checkoutSessionId:
                  payment.checkoutSessionId ?? evidence.checkoutSessionId,
                paymentIntentId:
                  payment.paymentIntentId ?? evidence.paymentIntentId,
                refundId: payment.refundId ?? incomingRefundId,
                refundStatus: incomingRefundStatus ?? payment.refundStatus,
                checkoutCompletedAt:
                  payment.checkoutCompletedAt ?? evidence.checkoutCompletedAt,
                refundRequestedAt:
                  payment.refundRequestedAt ?? evidence.refundRequestedAt,
                paidAt: payment.paidAt ?? evidence.paidAt,
                refundedAt: payment.refundedAt ?? evidence.refundedAt,
              },
              select: internalPaymentSelect,
            })
          : payment;

      await recordAuditEvent(
        {
          action: statusChanged
            ? "PAYMENT_STATUS_RECONCILED"
            : "PAYMENT_WEBHOOK_RECONCILED",
          entityType: "Payment",
          entityId: String(payment.id),
          before: paymentAuditProjection(payment),
          after: {
            ...paymentAuditProjection(updated),
            stripeEventId: event.id,
            stripeEventType: event.type,
          },
        },
        transaction,
      );
      if (statusChanged) {
        await createPaymentNotification(
          transaction,
          updated,
          `stripe-event:${event.id}`,
        );
      } else if (needsRefundStatusUpdate) {
        await createPaymentNotification(
          transaction,
          updated,
          `stripe-refund-event:${event.id}`,
          `Your contribution refund is now ${incomingRefundStatus?.replaceAll("_", " ")}.`,
        );
      }
      await transaction.paymentEvent.update({
        where: { id: storedEvent.id },
        data: {
          paymentId: payment.id,
          processedAt: new Date(),
          processingError: ignoredRegression
            ? "IGNORED_REGRESSIVE_TRANSITION"
            : null,
        },
      });

      return {
        handled: true,
        duplicate: false,
        applied:
          statusChanged ||
          needsIdentifierUpdate ||
          needsRefundStatusUpdate ||
          needsCheckoutCompletedAt ||
          needsRefundRequestedAt ||
          needsPaidAt ||
          needsRefundedAt,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 2_000,
      timeout: 5_000,
    },
  );

const isWebhookContentionError = (
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  webhookContentionCodes.has(error.code);

const processWebhookEvent = async (event: Stripe.Event) => {
  if (!isHandledPaymentWebhookType(event.type)) {
    return { handled: false, duplicate: false, applied: false };
  }
  const evidence = extractWebhookEvidence(event);

  for (let attempt = 1; attempt <= webhookTransactionAttempts; attempt += 1) {
    try {
      return await processWebhookEventOnce(event, evidence);
    } catch (error) {
      if (!isWebhookContentionError(error)) throw error;
      const existing = await prisma.paymentEvent.findUnique({
        where: { stripeEventId: event.id },
        select: { id: true },
      });
      if (existing) {
        return { handled: true, duplicate: true, applied: false };
      }
      if (attempt === webhookTransactionAttempts) {
        throw new AppError(
          httpStatus.SERVICE_UNAVAILABLE,
          "Payment webhook could not be processed due to concurrent updates",
        );
      }
    }
  }

  throw new AppError(
    httpStatus.SERVICE_UNAVAILABLE,
    "Payment webhook could not be processed",
  );
};

const handleWebhook = async (rawBody: Buffer, signature: string) => {
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.stripe.webhook_secret,
    );
  } catch {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Invalid Stripe webhook signature",
    );
  }
  const result = await processWebhookEvent(event);
  if (result.applied) await invalidateDashboardCache();
  return result;
};

const loadInternalPaymentOrThrow = async (paymentId: number) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: internalPaymentSelect,
  });
  if (!payment) {
    throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
  }
  return payment;
};

const assertPaymentAccess = (
  user: CurrentPaymentUser,
  payment: Pick<InternalPayment, "payerId">,
) => {
  if (user.role !== Role.ADMIN && payment.payerId !== user.userId) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "You do not have permission to access this payment",
    );
  }
};

const getPublicPayment = (paymentId: number) =>
  prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: paymentSelect,
  });

const getPayment = async (user: CurrentPaymentUser, paymentId: number) => {
  const payment = await loadInternalPaymentOrThrow(paymentId);
  assertPaymentAccess(user, payment);
  return getPublicPayment(payment.id);
};

const listMyPayments = async (userId: number, query: PaymentListQuery) => {
  const where = {
    payerId: userId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.purpose ? { purpose: query.purpose } : {}),
  } satisfies Prisma.PaymentWhereInput;
  const skip = (query.page - 1) * query.limit;
  const [data, total] = await prisma.$transaction([
    prisma.payment.findMany({
      where,
      select: paymentSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: query.limit,
    }),
    prisma.payment.count({ where }),
  ]);
  return { data, meta: { page: query.page, limit: query.limit, total } };
};

export function assertCheckoutCanBeCancelled(payment: {
  status: PaymentStatus;
  checkoutSessionId: string | null;
  checkoutCompletedAt: Date | null;
}): asserts payment is {
  status: PaymentStatus;
  checkoutSessionId: string;
  checkoutCompletedAt: null;
} {
  if (
    payment.status === PaymentStatus.OPEN &&
    payment.checkoutCompletedAt !== null
  ) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Checkout is complete and awaiting asynchronous payment confirmation",
    );
  }
  if (payment.status !== PaymentStatus.OPEN || !payment.checkoutSessionId) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Payments in ${payment.status} status cannot be cancelled`,
    );
  }
}

const nonExpireableCheckoutMessage =
  /^(?:this|the) (?:checkout )?session is not in an exp(?:ire|ir)able state(?:\.|$)/i;

export const isStripeCheckoutSessionNotExpireableError = (error: unknown) =>
  error instanceof Stripe.errors.StripeInvalidRequestError &&
  error.code !== "resource_missing" &&
  (error.code === "checkout_session_not_expireable" ||
    nonExpireableCheckoutMessage.test(error.message.trim()));

const cancelPayment = async (
  user: CurrentPaymentUser,
  paymentId: number,
  context: PaymentRequestContext,
) => {
  const payment = await loadInternalPaymentOrThrow(paymentId);
  assertPaymentAccess(user, payment);
  if (payment.status === PaymentStatus.CANCELLED) {
    return getPublicPayment(payment.id);
  }
  assertCheckoutCanBeCancelled(payment);

  let expiredSession: Stripe.Checkout.Session;
  try {
    expiredSession = await stripe.checkout.sessions.expire(
      payment.checkoutSessionId,
      {},
      { idempotencyKey: `payment-cancel:${payment.idempotencyKey}` },
    );
    assertCheckoutSessionEvidence(expiredSession, payment, "expired");
  } catch (error) {
    console.error("Stripe Checkout Session expiration failed", { paymentId });
    const sessionNotExpireable =
      isStripeCheckoutSessionNotExpireableError(error);
    await recordProviderFailure(
      payment.id,
      user.userId,
      "PAYMENT_CANCELLATION_FAILED",
      sessionNotExpireable
        ? "STRIPE_CHECKOUT_NOT_EXPIREABLE"
        : "STRIPE_CHECKOUT_EXPIRATION_FAILED",
      context,
    );
    if (sessionNotExpireable) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Checkout Session is no longer open; its payment status must be reconciled by Stripe webhook",
      );
    }
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Payment provider could not cancel the Checkout Session",
    );
  }

  const result = await prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE
      `;
      const current = await transaction.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: internalPaymentSelect,
      });
      if (current.status === PaymentStatus.CANCELLED) {
        return transaction.payment.findUniqueOrThrow({
          where: { id: current.id },
          select: paymentSelect,
        });
      }
      if (
        (current.status !== PaymentStatus.OPEN &&
          current.status !== PaymentStatus.EXPIRED) ||
        current.checkoutCompletedAt !== null ||
        current.checkoutSessionId !== expiredSession.id
      ) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Payment state changed while cancellation was being processed",
        );
      }

      const updated = await transaction.payment.update({
        where: { id: current.id },
        data: { status: PaymentStatus.CANCELLED },
        select: internalPaymentSelect,
      });
      await recordAuditEvent(
        {
          actorId: user.userId,
          action: "PAYMENT_CANCELLED",
          entityType: "Payment",
          entityId: String(current.id),
          before: paymentAuditProjection(current),
          after: paymentAuditProjection(updated),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );
      await createPaymentNotification(transaction, updated, "server-cancelled");
      return transaction.payment.findUniqueOrThrow({
        where: { id: updated.id },
        select: paymentSelect,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  await invalidateDashboardCache();
  return result;
};

const refundPayment = async (
  user: CurrentPaymentUser,
  paymentId: number,
  context: PaymentRequestContext,
) => {
  if (user.role !== Role.ADMIN) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Only administrators can refund payments",
    );
  }
  const payment = await loadInternalPaymentOrThrow(paymentId);
  if (payment.status === PaymentStatus.REFUNDED) {
    return {
      payment: await getPublicPayment(payment.id),
      refund: payment.refundId
        ? { id: payment.refundId, status: payment.refundStatus }
        : null,
      finalStatusPendingWebhook: false,
    };
  }
  if (payment.status !== PaymentStatus.PAID || !payment.paymentIntentId) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Payments in ${payment.status} status cannot be refunded`,
    );
  }
  if (payment.refundId) {
    return {
      payment: await getPublicPayment(payment.id),
      refund: { id: payment.refundId, status: payment.refundStatus },
      finalStatusPendingWebhook: true,
    };
  }

  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create(
      {
        payment_intent: payment.paymentIntentId,
        amount: payment.amount,
        reason: "requested_by_customer",
        metadata: { paymentId: String(payment.id) },
      },
      { idempotencyKey: `payment-refund:${payment.idempotencyKey}` },
    );
    if (
      refund.amount !== payment.amount ||
      refund.currency.toUpperCase() !== payment.currency ||
      expandableId(refund.payment_intent) !== payment.paymentIntentId ||
      refund.metadata?.paymentId !== String(payment.id) ||
      !isRecognizedProviderRefundStatus(refund.status) ||
      refund.status === "failed" ||
      refund.status === "canceled"
    ) {
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        "Stripe returned inconsistent refund data",
      );
    }
  } catch {
    console.error("Stripe refund creation failed", { paymentId });
    await recordProviderFailure(
      payment.id,
      user.userId,
      "PAYMENT_REFUND_FAILED",
      "STRIPE_REFUND_CREATION_FAILED",
      context,
    );
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Payment provider could not create the refund",
    );
  }

  const persistedPayment = await prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE
      `;
      const current = await transaction.payment.findUniqueOrThrow({
        where: { id: payment.id },
        select: internalPaymentSelect,
      });
      if (current.refundId && current.refundId !== refund.id) {
        throw new AppError(
          httpStatus.CONFLICT,
          "A different refund request is already linked to this payment",
        );
      }
      if (
        current.status !== PaymentStatus.PAID &&
        current.status !== PaymentStatus.REFUNDED
      ) {
        throw new AppError(
          httpStatus.CONFLICT,
          "Payment state changed while the refund was being requested",
        );
      }

      const resolvedRefundStatus = resolveProviderRefundStatus(
        current.refundStatus,
        refund.status,
      );
      const refundRequestedAt = new Date(refund.created * 1_000);
      const needsProviderResponsePersistence =
        !current.refundId ||
        resolvedRefundStatus !== current.refundStatus ||
        !current.refundRequestedAt;
      const updated = needsProviderResponsePersistence
        ? await transaction.payment.update({
            where: { id: current.id },
            data: {
              refundId: current.refundId ?? refund.id,
              refundStatus: resolvedRefundStatus,
              refundRequestedAt: current.refundRequestedAt ?? refundRequestedAt,
            },
            select: internalPaymentSelect,
          })
        : current;
      await recordAuditEvent(
        {
          actorId: user.userId,
          action: "PAYMENT_REFUND_REQUESTED",
          entityType: "Payment",
          entityId: String(current.id),
          before: paymentAuditProjection(current),
          after: paymentAuditProjection(updated),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
        transaction,
      );
      return transaction.payment.findUniqueOrThrow({
        where: { id: updated.id },
        select: paymentSelect,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (!persistedPayment.refundId || !persistedPayment.refundStatus) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "Refund request state was not persisted",
    );
  }

  await invalidateDashboardCache();
  return {
    payment: persistedPayment,
    refund: {
      id: persistedPayment.refundId,
      status: persistedPayment.refundStatus,
    },
    finalStatusPendingWebhook:
      persistedPayment.status !== PaymentStatus.REFUNDED,
  };
};

export const paymentService = {
  createCheckoutSession,
  handleWebhook,
  cancelPayment,
  refundPayment,
  getPayment,
  listMyPayments,
};
