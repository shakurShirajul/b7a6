import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { RegisterUserPayload } from "./user.interface";
import config from "../../config";
import { Role } from "../../../prisma/generated/prisma/enums";

const registerIntoDB = async (userData: RegisterUserPayload) => {
  const { name, email, password, role, phone } = userData;
  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (isUserExists) {
    throw new Error("User already exists");
  }

  const hashedPassword = await bcrypt.hash(
    password,
    Number(config.bcrypt_salt_rounds),
  );

  const userRole = role ?? Role.DONOR;

  const createUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: userRole,
      phone,
    },
    omit: {
      password: true,
    },
  });

  return createUser;
};

export const userService = {
  registerIntoDB,
};
