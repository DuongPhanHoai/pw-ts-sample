import type { UserRow } from "../types";

/**
 * Production: canary only.
 * One safe, read-only-ish account. Never put real customer credentials here —
 * use a dedicated synthetic monitoring account.
 */
export const users: UserRow[] = [
  { username: "standard_user", password: "secret_sauce", shouldLogin: true },
];
