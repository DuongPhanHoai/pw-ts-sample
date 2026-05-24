import type { UserRow } from "../types";

/** Dev: minimal smoke set — one happy path + one negative for fast feedback. */
export const users: UserRow[] = [
  { username: "standard_user", password: "secret_sauce", shouldLogin: true },
  {
    username: "invalid_user",
    password: "wrong_pass",
    shouldLogin: false,
    expectedError: "do not match",
  },
];
