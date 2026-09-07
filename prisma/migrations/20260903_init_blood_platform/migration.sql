-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PATIENT', 'DONOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('NORMAL', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "BloodRequestStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'MATCHING', 'PARTIALLY_FULFILLED', 'FULFILLED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'OPEN', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('EMERGENCY_SUPPORT', 'PLATFORM_SUPPORT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BLOOD_REQUEST', 'DONOR_INVITATION', 'REQUEST_ACCEPTED', 'REQUEST_REJECTED', 'DONATION_COMPLETED', 'PAYMENT_UPDATED', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "BloodType" AS ENUM ('A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BloodRequest" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "hospitalId" INTEGER NOT NULL,
    "bloodType" "BloodType" NOT NULL,
    "unitsRequired" INTEGER NOT NULL,
    "unitsFulfilled" INTEGER NOT NULL DEFAULT 0,
    "urgency" "Urgency" NOT NULL DEFAULT 'NORMAL',
    "status" "BloodRequestStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "description" TEXT,
    "proofUrl" TEXT,
    "requiredAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "fulfilledAt" TIMESTAMP(3),
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BloodRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Donation" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "bloodRequestId" INTEGER NOT NULL,
    "donorId" INTEGER NOT NULL,
    "patientId" INTEGER NOT NULL,
    "unitCount" INTEGER NOT NULL,
    "donatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedById" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Donation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonorAssignment" (
    "id" SERIAL NOT NULL,
    "bloodRequestId" INTEGER NOT NULL,
    "donorId" INTEGER NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'INVITED',
    "score" DECIMAL(12,3) NOT NULL,
    "distanceKm" DECIMAL(8,2),
    "matchReason" TEXT,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonorProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "bloodType" "BloodType" NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT false,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "weightKg" DECIMAL(5,2) NOT NULL,
    "totalDonationCount" INTEGER NOT NULL DEFAULT 0,
    "lastDonationDate" TIMESTAMP(3),
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DonorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DonorReservation" (
    "id" SERIAL NOT NULL,
    "donorId" INTEGER NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "bloodRequestId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DonorReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityAssessment" (
    "id" SERIAL NOT NULL,
    "donorId" INTEGER NOT NULL,
    "isEligible" BOOLEAN NOT NULL,
    "reasonCode" TEXT,
    "checkedById" INTEGER,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EligibilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hospital" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" INTEGER,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hospital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "bloodRequestId" INTEGER,
    "donorAssignmentId" INTEGER,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'BLOOD_REQUEST',
    "readAt" TIMESTAMP(3),
    "deliveryStatus" "NotificationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMP(3),
    "deduplicationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "bloodType" "BloodType" NOT NULL,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "totalReceivedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" SERIAL NOT NULL,
    "payerId" INTEGER NOT NULL,
    "bloodRequestId" INTEGER,
    "purpose" "PaymentPurpose" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "checkoutSessionId" TEXT,
    "paymentIntentId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" SERIAL NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentId" INTEGER,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestVerification" (
    "id" SERIAL NOT NULL,
    "bloodRequestId" INTEGER NOT NULL,
    "adminId" INTEGER NOT NULL,
    "decision" "VerificationStatus" NOT NULL,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" TEXT NOT NULL,
    "avatar" TEXT,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "dateOfBirth" TIMESTAMP(3),
    "gender" "Gender",
    "lastLoginAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_jti_key" ON "RefreshSession"("jti");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshSession_expiresAt_revokedAt_idx" ON "RefreshSession"("expiresAt", "revokedAt");

-- CreateIndex
CREATE INDEX "BloodRequest_status_urgency_requiredAt_idx" ON "BloodRequest"("status", "urgency", "requiredAt");

-- CreateIndex
CREATE INDEX "BloodRequest_bloodType_status_division_district_area_idx" ON "BloodRequest"("bloodType", "status", "division", "district", "area");

-- CreateIndex
CREATE INDEX "BloodRequest_latitude_longitude_idx" ON "BloodRequest"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "BloodRequest_patientId_status_idx" ON "BloodRequest"("patientId", "status");

-- CreateIndex
CREATE INDEX "BloodRequest_hospitalId_status_idx" ON "BloodRequest"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "BloodRequest_verifiedById_idx" ON "BloodRequest"("verifiedById");

-- CreateIndex
CREATE INDEX "BloodRequest_deletedAt_idx" ON "BloodRequest"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BloodRequest_id_patientId_key" ON "BloodRequest"("id", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Donation_assignmentId_key" ON "Donation"("assignmentId");

-- CreateIndex
CREATE INDEX "Donation_donorId_donatedAt_idx" ON "Donation"("donorId", "donatedAt");

-- CreateIndex
CREATE INDEX "Donation_bloodRequestId_idx" ON "Donation"("bloodRequestId");

-- CreateIndex
CREATE INDEX "Donation_patientId_donatedAt_idx" ON "Donation"("patientId", "donatedAt");

-- CreateIndex
CREATE INDEX "Donation_confirmedById_idx" ON "Donation"("confirmedById");

-- CreateIndex
CREATE UNIQUE INDEX "Donation_assignmentId_donorId_bloodRequestId_key" ON "Donation"("assignmentId", "donorId", "bloodRequestId");

-- CreateIndex
CREATE INDEX "DonorAssignment_donorId_status_idx" ON "DonorAssignment"("donorId", "status");

-- CreateIndex
CREATE INDEX "DonorAssignment_bloodRequestId_status_idx" ON "DonorAssignment"("bloodRequestId", "status");

-- CreateIndex
CREATE INDEX "DonorAssignment_status_expiresAt_idx" ON "DonorAssignment"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DonorAssignment_bloodRequestId_donorId_key" ON "DonorAssignment"("bloodRequestId", "donorId");

-- CreateIndex
CREATE UNIQUE INDEX "DonorAssignment_id_donorId_bloodRequestId_key" ON "DonorAssignment"("id", "donorId", "bloodRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "DonorProfile_userId_key" ON "DonorProfile"("userId");

-- CreateIndex
CREATE INDEX "DonorProfile_bloodType_verificationStatus_isAvailable_lastD_idx" ON "DonorProfile"("bloodType", "verificationStatus", "isAvailable", "lastDonationDate");

-- CreateIndex
CREATE INDEX "DonorProfile_division_district_area_bloodType_idx" ON "DonorProfile"("division", "district", "area", "bloodType");

-- CreateIndex
CREATE INDEX "DonorProfile_latitude_longitude_idx" ON "DonorProfile"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "DonorProfile_verifiedById_idx" ON "DonorProfile"("verifiedById");

-- CreateIndex
CREATE UNIQUE INDEX "DonorReservation_donorId_key" ON "DonorReservation"("donorId");

-- CreateIndex
CREATE UNIQUE INDEX "DonorReservation_assignmentId_key" ON "DonorReservation"("assignmentId");

-- CreateIndex
CREATE INDEX "DonorReservation_bloodRequestId_expiresAt_idx" ON "DonorReservation"("bloodRequestId", "expiresAt");

-- CreateIndex
CREATE INDEX "DonorReservation_expiresAt_idx" ON "DonorReservation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DonorReservation_assignmentId_donorId_bloodRequestId_key" ON "DonorReservation"("assignmentId", "donorId", "bloodRequestId");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_donorId_expiresAt_idx" ON "EligibilityAssessment"("donorId", "expiresAt");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_checkedById_idx" ON "EligibilityAssessment"("checkedById");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityAssessment_donorId_checkedAt_key" ON "EligibilityAssessment"("donorId", "checkedAt");

-- CreateIndex
CREATE INDEX "Hospital_name_idx" ON "Hospital"("name");

-- CreateIndex
CREATE INDEX "Hospital_verificationStatus_division_district_area_idx" ON "Hospital"("verificationStatus", "division", "district", "area");

-- CreateIndex
CREATE INDEX "Hospital_latitude_longitude_idx" ON "Hospital"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Hospital_verifiedById_idx" ON "Hospital"("verifiedById");

-- CreateIndex
CREATE INDEX "Hospital_deletedAt_idx" ON "Hospital"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Hospital_name_address_key" ON "Hospital"("name", "address");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_deduplicationKey_key" ON "Notification"("deduplicationKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_bloodRequestId_idx" ON "Notification"("bloodRequestId");

-- CreateIndex
CREATE INDEX "Notification_donorAssignmentId_idx" ON "Notification"("donorAssignmentId");

-- CreateIndex
CREATE INDEX "OutboxEvent_processedAt_availableAt_idx" ON "OutboxEvent"("processedAt", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_type_aggregateId_idx" ON "OutboxEvent"("type", "aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfile_userId_key" ON "PatientProfile"("userId");

-- CreateIndex
CREATE INDEX "PatientProfile_bloodType_idx" ON "PatientProfile"("bloodType");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_checkoutSessionId_key" ON "Payment"("checkoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paymentIntentId_key" ON "Payment"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_payerId_status_idx" ON "Payment"("payerId", "status");

-- CreateIndex
CREATE INDEX "Payment_bloodRequestId_status_idx" ON "Payment"("bloodRequestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_stripeEventId_key" ON "PaymentEvent"("stripeEventId");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentId_receivedAt_idx" ON "PaymentEvent"("paymentId", "receivedAt");

-- CreateIndex
CREATE INDEX "PaymentEvent_processedAt_idx" ON "PaymentEvent"("processedAt");

-- CreateIndex
CREATE INDEX "RequestVerification_bloodRequestId_createdAt_idx" ON "RequestVerification"("bloodRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "RequestVerification_adminId_createdAt_idx" ON "RequestVerification"("adminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BloodRequest" ADD CONSTRAINT "BloodRequest_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_assignmentId_donorId_bloodRequestId_fkey" FOREIGN KEY ("assignmentId", "donorId", "bloodRequestId") REFERENCES "DonorAssignment"("id", "donorId", "bloodRequestId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_bloodRequestId_patientId_fkey" FOREIGN KEY ("bloodRequestId", "patientId") REFERENCES "BloodRequest"("id", "patientId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "DonorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "PatientProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Donation" ADD CONSTRAINT "Donation_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorAssignment" ADD CONSTRAINT "DonorAssignment_bloodRequestId_fkey" FOREIGN KEY ("bloodRequestId") REFERENCES "BloodRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorAssignment" ADD CONSTRAINT "DonorAssignment_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "DonorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorProfile" ADD CONSTRAINT "DonorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorProfile" ADD CONSTRAINT "DonorProfile_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorReservation" ADD CONSTRAINT "DonorReservation_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "DonorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorReservation" ADD CONSTRAINT "DonorReservation_assignmentId_donorId_bloodRequestId_fkey" FOREIGN KEY ("assignmentId", "donorId", "bloodRequestId") REFERENCES "DonorAssignment"("id", "donorId", "bloodRequestId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DonorReservation" ADD CONSTRAINT "DonorReservation_bloodRequestId_fkey" FOREIGN KEY ("bloodRequestId") REFERENCES "BloodRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityAssessment" ADD CONSTRAINT "EligibilityAssessment_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "DonorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibilityAssessment" ADD CONSTRAINT "EligibilityAssessment_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hospital" ADD CONSTRAINT "Hospital_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_bloodRequestId_fkey" FOREIGN KEY ("bloodRequestId") REFERENCES "BloodRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_donorAssignmentId_fkey" FOREIGN KEY ("donorAssignmentId") REFERENCES "DonorAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bloodRequestId_fkey" FOREIGN KEY ("bloodRequestId") REFERENCES "BloodRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVerification" ADD CONSTRAINT "RequestVerification_bloodRequestId_fkey" FOREIGN KEY ("bloodRequestId") REFERENCES "BloodRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestVerification" ADD CONSTRAINT "RequestVerification_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Case-insensitive identity uniqueness. Application code must normalize email
-- before lookup; this index remains the final database guard.
CREATE UNIQUE INDEX "User_email_normalized_key" ON "User" (LOWER("email"));

-- Domain checks that Prisma Schema Language cannot currently express.
ALTER TABLE "BloodRequest"
  ADD CONSTRAINT "BloodRequest_unitsRequired_positive" CHECK ("unitsRequired" > 0),
  ADD CONSTRAINT "BloodRequest_unitsFulfilled_nonnegative" CHECK ("unitsFulfilled" >= 0),
  ADD CONSTRAINT "BloodRequest_unitsFulfilled_lte_required" CHECK ("unitsFulfilled" <= "unitsRequired"),
  ADD CONSTRAINT "BloodRequest_latitude_range" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "BloodRequest_longitude_range" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

ALTER TABLE "DonorProfile"
  ADD CONSTRAINT "DonorProfile_weightKg_positive" CHECK ("weightKg" > 0),
  ADD CONSTRAINT "DonorProfile_totalDonationCount_nonnegative" CHECK ("totalDonationCount" >= 0),
  ADD CONSTRAINT "DonorProfile_latitude_range" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "DonorProfile_longitude_range" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

ALTER TABLE "Hospital"
  ADD CONSTRAINT "Hospital_latitude_range" CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "Hospital_longitude_range" CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

ALTER TABLE "PatientProfile"
  ADD CONSTRAINT "PatientProfile_totalReceivedCount_nonnegative" CHECK ("totalReceivedCount" >= 0);

ALTER TABLE "Donation"
  ADD CONSTRAINT "Donation_unitCount_positive" CHECK ("unitCount" > 0);

ALTER TABLE "DonorAssignment"
  ADD CONSTRAINT "DonorAssignment_distanceKm_nonnegative" CHECK ("distanceKm" IS NULL OR "distanceKm" >= 0);

ALTER TABLE "OutboxEvent"
  ADD CONSTRAINT "OutboxEvent_attempts_nonnegative" CHECK ("attempts" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "Payment_currency_uppercase" CHECK ("currency" = UPPER("currency"));

-- PostgreSQL CHECK constraints cannot inspect related rows, so a trigger
-- enforces that new or reassigned donor invitations reference live resources.
CREATE FUNCTION "enforce_active_assignment_references"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BloodRequest"
    WHERE "id" = NEW."bloodRequestId" AND "deletedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'DonorAssignment cannot reference a soft-deleted BloodRequest'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "DonorProfile" AS donor
    JOIN "User" AS account ON account."id" = donor."userId"
    WHERE donor."id" = NEW."donorId" AND account."deletedAt" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'DonorAssignment cannot reference a soft-deleted donor'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "DonorAssignment_active_references_check"
BEFORE INSERT OR UPDATE OF "bloodRequestId", "donorId" ON "DonorAssignment"
FOR EACH ROW
EXECUTE FUNCTION "enforce_active_assignment_references"();

-- Audit logs are immutable after insertion. Inserts remain available to the
-- application, while every UPDATE or DELETE fails explicitly.
CREATE FUNCTION "prevent_audit_log_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only; UPDATE and DELETE are forbidden'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "AuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION "prevent_audit_log_mutation"();
