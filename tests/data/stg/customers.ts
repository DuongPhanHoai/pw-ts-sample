import type { CustomerRow } from "../types";

/** Staging: two profiles — enough to vary form input without exploding the matrix. */
export const customers: CustomerRow[] = [
  { firstName: "Stg", lastName: "Tester", postalCode: "55555" },
  { firstName: "Jane", lastName: "Doe", postalCode: "90210" },
];
