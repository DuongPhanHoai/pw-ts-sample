export type UserRow = {
  username: string;
  password: string;
  shouldLogin: boolean;
  /** Substring/regex fragment expected in the on-page error when shouldLogin is false. */
  expectedError?: string;
};

export const users: UserRow[] = [
  {
    username: "standard_user",
    password: "secret_sauce",
    shouldLogin: true,
  },
  {
    username: "problem_user",
    password: "secret_sauce",
    shouldLogin: true,
  },
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
