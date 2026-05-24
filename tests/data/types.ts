/**
 * Shared row types used by all per-environment data fixtures.
 * Keeping these in one place guarantees every env exposes the same shape.
 */

export type UserRow = {
  username: string;
  password: string;
  shouldLogin: boolean;
  /** Substring/regex fragment expected in the on-page error when shouldLogin is false. */
  expectedError?: string;
};

export type ProductRow = {
  /** Suffix used in the data-test attribute, e.g. add-to-cart-<slug>. */
  slug: string;
  name: string;
};

export type CustomerRow = {
  firstName: string;
  lastName: string;
  postalCode: string;
};
