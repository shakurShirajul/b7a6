import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import {
  BloodRequestStatus,
  BloodType,
  Gender,
  Role,
  Urgency,
  UserStatus,
  VerificationStatus,
} from "../generated/prisma/enums.js";

const databaseUrl = process.env["DATABASE_URL"];
const configuredDemoPassword = process.env["DEMO_PASSWORD"]?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run the demo seed");
}

if (process.env["NODE_ENV"] === "production" && !configuredDemoPassword) {
  throw new Error("DEMO_PASSWORD is required when seeding in production");
}

const demoPassword = configuredDemoPassword || "LocalDemoOnly!ChangeMe2026";
const saltRounds = Number(process.env["BCRYPT_SALT_ROUNDS"] || 12);

if (!Number.isInteger(saltRounds) || saltRounds < 4 || saltRounds > 31) {
  throw new Error("BCRYPT_SALT_ROUNDS must be an integer between 4 and 31");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

const fixedDates = {
  verifiedAt: new Date("2026-09-01T08:00:00.000Z"),
  assessmentAt: new Date("2026-09-01T09:00:00.000Z"),
  assessmentExpiresAt: new Date("2027-03-01T09:00:00.000Z"),
  requestOneRequiredAt: new Date("2026-09-10T08:00:00.000Z"),
  requestTwoRequiredAt: new Date("2026-09-12T12:00:00.000Z"),
} as const;

const ensureDemoUser = async (
  transaction: Prisma.TransactionClient,
  data: Prisma.UserCreateInput,
) => {
  await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "email" = ${data.email} FOR UPDATE`;
  const existing = await transaction.user.findUnique({
    where: { email: data.email },
    select: { id: true, role: true },
  });
  if (existing && existing.role !== data.role) {
    throw new Error(
      `Demo identity role collision: ${data.email}. Seed aborted without promoting or changing the account.`,
    );
  }
  if (!existing) return transaction.user.create({ data, select: { id: true } });
  const user = await transaction.user.update({
    where: { id: existing.id },
    data: {
      password: data.password,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    },
    select: { id: true },
  });
  await transaction.refreshSession.deleteMany({
    where: { userId: existing.id },
  });
  return user;
};

const getFixtureBinding = async (
  transaction: Prisma.TransactionClient,
  key: string,
) => {
  const binding = await transaction.auditLog.findFirst({
    where: {
      action: "DEMO_FIXTURE_BOUND",
      after: { path: ["fixtureKey"], equals: key },
    },
    select: { entityId: true },
    orderBy: { id: "asc" },
  });
  return binding ? Number(binding.entityId) : undefined;
};

const bindFixture = async (
  transaction: Prisma.TransactionClient,
  adminId: number,
  key: string,
  entityType: string,
  id: number,
  binding?: number,
) => {
  if (binding !== undefined) return;
  await transaction.auditLog.create({
    data: {
      actorId: adminId,
      action: "DEMO_FIXTURE_BOUND",
      entityType,
      entityId: String(id),
      after: { fixtureKey: key },
    },
  });
};

const seedFixtures = async (
  prisma: Prisma.TransactionClient,
  passwordHash: string,
) => {
  // Serialize reruns, including first creation and stable fixture bindings.
  await prisma.$queryRaw`SELECT pg_advisory_xact_lock(760903, 14)::text`;

  const admin = await ensureDemoUser(prisma, {
    name: "Demo Administrator",
    email: "admin.demo@blood.local",
    phone: "+8801700000001",
    password: passwordHash,
    role: Role.ADMIN,
    status: UserStatus.ACTIVE,
    emailVerifiedAt: fixedDates.verifiedAt,
  });

  const patientUser = await ensureDemoUser(prisma, {
    name: "Demo Patient",
    email: "patient.demo@blood.local",
    phone: "+8801700000002",
    password: passwordHash,
    role: Role.PATIENT,
    status: UserStatus.ACTIVE,
    dateOfBirth: new Date("1994-04-15T00:00:00.000Z"),
    gender: Gender.FEMALE,
    emailVerifiedAt: fixedDates.verifiedAt,
  });

  const patient = await prisma.patientProfile.upsert({
    where: { userId: patientUser.id },
    update: {},
    create: {
      userId: patientUser.id,
      bloodType: BloodType.A_POSITIVE,
      emergencyContactName: "Demo Emergency Contact",
      emergencyContactPhone: "+8801700000099",
    },
  });

  const donorFixtures = [
    {
      email: "donor.apositive@blood.local",
      name: "Demo A Positive Donor",
      phone: "+8801700000011",
      bloodType: BloodType.A_POSITIVE,
      dateOfBirth: new Date("1992-02-10T00:00:00.000Z"),
      weightKg: "68.50",
      division: "Dhaka",
      district: "Dhaka",
      area: "Dhanmondi",
      latitude: "23.746466",
      longitude: "90.376015",
    },
    {
      email: "donor.onegative@blood.local",
      name: "Demo O Negative Donor",
      phone: "+8801700000012",
      bloodType: BloodType.O_NEGATIVE,
      dateOfBirth: new Date("1989-07-21T00:00:00.000Z"),
      weightKg: "74.00",
      division: "Dhaka",
      district: "Dhaka",
      area: "Mirpur",
      latitude: "23.822349",
      longitude: "90.365421",
    },
    {
      email: "donor.bpositive@blood.local",
      name: "Demo B Positive Donor",
      phone: "+8801700000013",
      bloodType: BloodType.B_POSITIVE,
      dateOfBirth: new Date("1996-11-03T00:00:00.000Z"),
      weightKg: "62.75",
      division: "Chattogram",
      district: "Chattogram",
      area: "Panchlaish",
      latitude: "22.359899",
      longitude: "91.821187",
    },
  ] as const;

  const donors = [];

  for (const fixture of donorFixtures) {
    const user = await ensureDemoUser(prisma, {
      name: fixture.name,
      email: fixture.email,
      phone: fixture.phone,
      password: passwordHash,
      role: Role.DONOR,
      status: UserStatus.ACTIVE,
      dateOfBirth: fixture.dateOfBirth,
      emailVerifiedAt: fixedDates.verifiedAt,
    });

    const donor = await prisma.donorProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        bloodType: fixture.bloodType,
        isAvailable: true,
        verificationStatus: VerificationStatus.VERIFIED,
        verifiedAt: fixedDates.verifiedAt,
        verifiedById: admin.id,
        weightKg: fixture.weightKg,
        division: fixture.division,
        district: fixture.district,
        area: fixture.area,
        latitude: fixture.latitude,
        longitude: fixture.longitude,
        eligibilityAssessments: {
          create: {
            isEligible: true,
            checkedById: admin.id,
            checkedAt: fixedDates.assessmentAt,
            expiresAt: fixedDates.assessmentExpiresAt,
          },
        },
      },
    });

    donors.push(donor);
  }

  const dhakaBinding = await getFixtureBinding(prisma, "hospital:dhaka");
  if (dhakaBinding)
    await prisma.hospital.findUniqueOrThrow({
      where: { id: dhakaBinding },
      select: { id: true },
    });
  const dhakaHospital = await prisma.hospital.upsert({
    where: dhakaBinding
      ? { id: dhakaBinding }
      : {
          name_address: {
            name: "Dhaka Medical College Hospital",
            address: "Secretariat Road, Shahbagh, Dhaka",
          },
        },
    update: {},
    create: {
      name: "Dhaka Medical College Hospital",
      address: "Secretariat Road, Shahbagh, Dhaka",
      contactPhone: "+880255165101",
      contactEmail: "demo-dmch@blood.local",
      division: "Dhaka",
      district: "Dhaka",
      area: "Shahbagh",
      latitude: "23.725750",
      longitude: "90.397981",
      verificationStatus: VerificationStatus.VERIFIED,
      verifiedAt: fixedDates.verifiedAt,
      verifiedById: admin.id,
    },
  });
  await bindFixture(
    prisma,
    admin.id,
    "hospital:dhaka",
    "Hospital",
    dhakaHospital.id,
    dhakaBinding,
  );

  const chattogramBinding = await getFixtureBinding(
    prisma,
    "hospital:chattogram",
  );
  if (chattogramBinding)
    await prisma.hospital.findUniqueOrThrow({
      where: { id: chattogramBinding },
      select: { id: true },
    });
  const chattogramHospital = await prisma.hospital.upsert({
    where: chattogramBinding
      ? { id: chattogramBinding }
      : {
          name_address: {
            name: "Chattogram Medical College Hospital",
            address: "K.B. Fazlul Kader Road, Panchlaish, Chattogram",
          },
        },
    update: {},
    create: {
      name: "Chattogram Medical College Hospital",
      address: "K.B. Fazlul Kader Road, Panchlaish, Chattogram",
      contactPhone: "+8802333350180",
      contactEmail: "demo-cmch@blood.local",
      division: "Chattogram",
      district: "Chattogram",
      area: "Panchlaish",
      latitude: "22.358357",
      longitude: "91.831678",
      verificationStatus: VerificationStatus.VERIFIED,
      verifiedAt: fixedDates.verifiedAt,
      verifiedById: admin.id,
    },
  });
  await bindFixture(
    prisma,
    admin.id,
    "hospital:chattogram",
    "Hospital",
    chattogramHospital.id,
    chattogramBinding,
  );

  const requestFixtures = [
    {
      hospitalId: dhakaHospital.id,
      bloodType: BloodType.A_POSITIVE,
      unitsRequired: 2,
      urgency: Urgency.EMERGENCY,
      status: BloodRequestStatus.MATCHING,
      description: "Deterministic demo request for matching workflows.",
      proofUrl: "https://example.invalid/demo-proof/dhaka-a-positive",
      requiredAt: fixedDates.requestOneRequiredAt,
      division: "Dhaka",
      district: "Dhaka",
      area: "Shahbagh",
      latitude: "23.725750",
      longitude: "90.397981",
    },
    {
      hospitalId: chattogramHospital.id,
      bloodType: BloodType.B_POSITIVE,
      unitsRequired: 1,
      urgency: Urgency.HIGH,
      status: BloodRequestStatus.VERIFIED,
      description: "Deterministic demo request for verification workflows.",
      proofUrl: "https://example.invalid/demo-proof/chattogram-b-positive",
      requiredAt: fixedDates.requestTwoRequiredAt,
      division: "Chattogram",
      district: "Chattogram",
      area: "Panchlaish",
      latitude: "22.358357",
      longitude: "91.831678",
    },
  ] as const;

  for (const fixture of requestFixtures) {
    const binding = await getFixtureBinding(prisma, fixture.proofUrl);
    const existing = await prisma.bloodRequest.findFirst({
      where: binding
        ? { id: binding }
        : {
            patientId: patient.id,
            hospitalId: fixture.hospitalId,
            requiredAt: fixture.requiredAt,
          },
      select: { id: true },
    });

    const data = {
      ...fixture,
      unitsFulfilled: 0,
      verifiedAt: fixedDates.verifiedAt,
      verifiedById: admin.id,
      fulfilledAt: null,
      deletedAt: null,
    };

    if (binding && !existing)
      throw new Error(
        "A bound demo request is missing; review the fixture binding before reseeding",
      );
    if (!existing) {
      const hospital = await prisma.hospital.findUniqueOrThrow({
        where: { id: fixture.hospitalId },
        select: { verificationStatus: true, deletedAt: true },
      });
      if (
        hospital.deletedAt ||
        hospital.verificationStatus !== VerificationStatus.VERIFIED
      ) {
        throw new Error(
          "A demo hospital is no longer verified; seed will not create an active request or restore its verification",
        );
      }
    }
    const request =
      existing ??
      (await prisma.bloodRequest.create({
        data: { ...data, patientId: patient.id },
        select: { id: true },
      }));
    await bindFixture(
      prisma,
      admin.id,
      fixture.proofUrl,
      "BloodRequest",
      request.id,
      binding,
    );
  }

  console.log(
    `Ensured ${2 + donors.length} demo users, ${donors.length} donor profiles, 2 hospitals, and ${requestFixtures.length} blood requests; existing workflow data preserved.`,
  );
};

const main = async () => {
  const passwordHash = await bcrypt.hash(demoPassword, saltRounds);
  await prisma.$transaction(
    (transaction) => seedFixtures(transaction, passwordHash),
    {
      isolationLevel: "ReadCommitted",
      timeout: 30_000,
    },
  );
};

main()
  .catch((error: unknown) => {
    console.error("Demo seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
