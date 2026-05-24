import type { UserRow } from "../types";

/** Staging: success-path users only — no negative cases against pre-prod. */
export const users: UserRow[] = [
  { username: "standard_user", password: "secret_sauce", shouldLogin: true },
  { username: "problem_user", password: "secret_sauce", shouldLogin: true },
];
