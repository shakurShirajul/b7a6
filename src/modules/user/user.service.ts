import httpStatus from "http-status";
import type { Prisma } from "../../generated/prisma/client.js";
import {
  Role,
  UserStatus,
  VerificationStatus,
} from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { requireOwnerOrAdmin } from "../../middlewares/auth.js";
import { recordAuditEvent } from "../../shared/audit.js";
import { lockDonorEvidenceForUser } from "../../shared/donor-evidence-lock.js";
import type { TRequestContext } from "../auth/auth.interface.js";
import type { UpdateMyProfilePayload } from "./user.interface.js";

type CurrentUser = NonNullable<Express.Request["user"]>;

const myProfileSelect = {
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
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  patientProfile: {
    select: {
      id: true,
      bloodType: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      totalReceivedCount: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  donorProfile: {
    select: {
      id: true,
      bloodType: true,
      verificationStatus: true,
      verifiedAt: true,
      weightKg: true,
      totalDonationCount: true,
      lastDonationDate: true,
      division: true,
      district: true,
      area: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.UserSelect;

const getMyProfile = async (currentUser: CurrentUser) => {
  const user = await prisma.user.findUnique({
    where: {
      id: currentUser.userId,
      status: UserStatus.ACTIVE,
      deletedAt: null,
    },
    select: myProfileSelect,
  });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User profile not found");
  }

  requireOwnerOrAdmin(currentUser, user.id);
  return user;
};

const auditProjection = (user: {
  name: string;
  phone: string;
  avatar: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
}) => ({
  name: user.name,
  phone: user.phone,
  avatar: user.avatar,
  dateOfBirth: user.dateOfBirth?.toISOString() ?? null,
  gender: user.gender,
});

const updateMyProfile = async (
  currentUser: CurrentUser,
  payload: UpdateMyProfilePayload,
  context: TRequestContext,
) =>
  prisma.$transaction(async (transaction) => {
    await lockDonorEvidenceForUser(transaction, currentUser.userId);
    const existingUser = await transaction.user.findUnique({
      where: { id: currentUser.userId },
      select: {
        id: true,
        name: true,
        phone: true,
        avatar: true,
        dateOfBirth: true,
        gender: true,
        role: true,
        status: true,
        deletedAt: true,
        donorProfile: { select: { id: true } },
      },
    });

    if (
      !existingUser ||
      existingUser.status !== UserStatus.ACTIVE ||
      existingUser.deletedAt
    ) {
      throw new AppError(httpStatus.NOT_FOUND, "User profile not found");
    }

    requireOwnerOrAdmin(currentUser, existingUser.id);
    const dateOfBirthChanged =
      payload.dateOfBirth !== undefined &&
      (payload.dateOfBirth?.getTime() ?? null) !==
        (existingUser.dateOfBirth?.getTime() ?? null);
    const donorEligibilityEvidenceChanged =
      existingUser.role === Role.DONOR &&
      Boolean(existingUser.donorProfile) &&
      dateOfBirthChanged;
    const updatedUser = await transaction.user.update({
      where: { id: existingUser.id },
      data: {
        ...payload,
        ...(donorEligibilityEvidenceChanged
          ? {
              donorProfile: {
                update: {
                  verificationStatus: VerificationStatus.PENDING,
                  verifiedAt: null,
                  verifiedBy: { disconnect: true },
                  isAvailable: false,
                },
              },
            }
          : {}),
      },
      select: myProfileSelect,
    });
    await recordAuditEvent(
      {
        actorId: currentUser.userId,
        action: "USER_PROFILE_UPDATED",
        entityType: "User",
        entityId: String(existingUser.id),
        before: auditProjection(existingUser),
        after: auditProjection(updatedUser),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      transaction,
    );

    return updatedUser;
  });

export const userService = {
  getMyProfile,
  updateMyProfile,
};
