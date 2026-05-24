import type { UserRow } from "../types";

/** Test: full coverage matrix — positive + negative paths. */
export const users: UserRow[] = [
  { username: "standard_user", password: "secret_sauce", shouldLogin: true },
  { username: "problem_user", password: "secret_sauce", shouldLogin: true },
  {
    username: "performance_glitch_user",
    password: "secret_sauce",
    shouldLogin: true,
  },
  {
    username: "locked_out_user",
    password: "secret_sauce",
    shouldLogin: false,
    expectedError: "locked out",
  },
  {
    username: "invalid_user",
    password: "wrong_pass",
    shouldLogin: false,
    expectedError: "do not match",
  },
];
