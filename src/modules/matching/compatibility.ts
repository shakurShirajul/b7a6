/**
 * Packed red-cell compatibility only. Plasma compatibility follows a
 * different matrix and is intentionally outside this module.
 */
export type BloodType =
  | "O_NEGATIVE"
  | "O_POSITIVE"
  | "A_NEGATIVE"
  | "A_POSITIVE"
  | "B_NEGATIVE"
  | "B_POSITIVE"
  | "AB_NEGATIVE"
  | "AB_POSITIVE";

const freezeDonorTypes = (types: BloodType[]) => Object.freeze(types);

const compatibleDonorTypes: Readonly<Record<BloodType, readonly BloodType[]>> =
  Object.freeze({
    O_NEGATIVE: freezeDonorTypes(["O_NEGATIVE"]),
    O_POSITIVE: freezeDonorTypes(["O_NEGATIVE", "O_POSITIVE"]),
    A_NEGATIVE: freezeDonorTypes(["O_NEGATIVE", "A_NEGATIVE"]),
    A_POSITIVE: freezeDonorTypes([
      "O_NEGATIVE",
      "O_POSITIVE",
      "A_NEGATIVE",
      "A_POSITIVE",
    ]),
    B_NEGATIVE: freezeDonorTypes(["O_NEGATIVE", "B_NEGATIVE"]),
    B_POSITIVE: freezeDonorTypes([
      "O_NEGATIVE",
      "O_POSITIVE",
      "B_NEGATIVE",
      "B_POSITIVE",
    ]),
    AB_NEGATIVE: freezeDonorTypes([
      "O_NEGATIVE",
      "A_NEGATIVE",
      "B_NEGATIVE",
      "AB_NEGATIVE",
    ]),
    AB_POSITIVE: freezeDonorTypes([
      "O_NEGATIVE",
      "O_POSITIVE",
      "A_NEGATIVE",
      "A_POSITIVE",
      "B_NEGATIVE",
      "B_POSITIVE",
      "AB_NEGATIVE",
      "AB_POSITIVE",
    ]),
  });

export const getCompatibleDonorTypes = (recipient: BloodType) =>
  compatibleDonorTypes[recipient];
