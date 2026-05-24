import type { CustomerRow } from "../types";

/**
 * Production: a single synthetic checkout profile.
 * Replace with whatever your synthetic-monitoring account is allowed to submit.
 */
export const customers: CustomerRow[] = [
  { firstName: "Synthetic", lastName: "Monitor", postalCode: "00000" },
];
