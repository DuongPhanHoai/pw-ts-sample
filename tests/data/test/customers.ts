import type { CustomerRow } from "../types";

/** Test: multiple customer profiles to broaden checkout-form coverage. */
export const customers: CustomerRow[] = [
  { firstName: "Test", lastName: "User", postalCode: "12345" },
  { firstName: "Jane", lastName: "Doe", postalCode: "90210" },
  { firstName: "Alex", lastName: "Nguyen", postalCode: "70000" },
];
