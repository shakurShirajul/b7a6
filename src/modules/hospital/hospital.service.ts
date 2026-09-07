import httpStatus from "http-status";
import type { Prisma } from "../../generated/prisma/client.js";
import { Role, VerificationStatus } from "../../generated/prisma/enums.js";
import { AppError } from "../../errors/AppError.js";
import { prisma } from "../../lib/prisma.js";
import type { HospitalListQuery } from "./hospital.interface.js";

const hospitalPublicSelect = {
  id: true,
  name: true,
  address: true,
  contactPhone: true,
  contactEmail: true,
  division: true,
  district: true,
  area: true,
  latitude: true,
  longitude: true,
} satisfies Prisma.HospitalSelect;

const publicVisibilityWhere = {
  verificationStatus: VerificationStatus.VERIFIED,
  deletedAt: null,
} satisfies Prisma.HospitalWhereInput;

const getVisibilityWhere = (role: Role): Prisma.HospitalWhereInput =>
  role === Role.ADMIN ? {} : publicVisibilityWhere;

const listHospitals = async (role: Role, query: HospitalListQuery) => {
  const locationWhere: Prisma.HospitalWhereInput = {
    ...(query.division
      ? { division: { equals: query.division, mode: "insensitive" } }
      : {}),
    ...(query.district
      ? { district: { equals: query.district, mode: "insensitive" } }
      : {}),
    ...(query.area
      ? { area: { equals: query.area, mode: "insensitive" } }
      : {}),
  };
  const searchWhere: Prisma.HospitalWhereInput = query.q
    ? {
        OR: [
          { name: { contains: query.q, mode: "insensitive" } },
          { address: { contains: query.q, mode: "insensitive" } },
        ],
      }
    : {};
  const where: Prisma.HospitalWhereInput = {
    AND: [getVisibilityWhere(role), locationWhere, searchWhere],
  };
  const skip = (query.page - 1) * query.limit;
  const [data, total] = await prisma.$transaction([
    prisma.hospital.findMany({
      where,
      select: hospitalPublicSelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take: query.limit,
    }),
    prisma.hospital.count({ where }),
  ]);

  return {
    data,
    meta: { page: query.page, limit: query.limit, total },
  };
};

const getHospitalById = async (role: Role, id: number) => {
  const hospital = await prisma.hospital.findFirst({
    where: { id, ...getVisibilityWhere(role) },
    select: hospitalPublicSelect,
  });

  if (!hospital) {
    throw new AppError(httpStatus.NOT_FOUND, "Hospital not found");
  }

  return hospital;
};

export const hospitalService = {
  listHospitals,
  getHospitalById,
};
