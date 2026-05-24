/**
 * Single environment-aware entry point for all test data.
 *
 * Specs import `users`, `products`, `customers` (and the row types) from here
 * and stay env-agnostic. Switch envs via TEST_ENV — see tests/config/env.ts.
 */

import type { Env } from "../config/env";
import { getEnv } from "../config/env";
import type { CustomerRow, ProductRow, UserRow } from "./types";

import { users as devUsers } from "./dev/users";
import { products as devProducts } from "./dev/products";
import { customers as devCustomers } from "./dev/customers";

import { users as testUsers } from "./test/users";
import { products as testProducts } from "./test/products";
import { customers as testCustomers } from "./test/customers";

import { users as stgUsers } from "./stg/users";
import { products as stgProducts } from "./stg/products";
import { customers as stgCustomers } from "./stg/customers";

import { users as prdUsers } from "./prd/users";
import { products as prdProducts } from "./prd/products";
import { customers as prdCustomers } from "./prd/customers";

type EnvData = {
  users: UserRow[];
  products: ProductRow[];
  customers: CustomerRow[];
};

const byEnv: Record<Env, EnvData> = {
  dev: { users: devUsers, products: devProducts, customers: devCustomers },
  test: { users: testUsers, products: testProducts, customers: testCustomers },
  stg: { users: stgUsers, products: stgProducts, customers: stgCustomers },
  prd: { users: prdUsers, products: prdProducts, customers: prdCustomers },
};

const active = byEnv[getEnv()];

export type { CustomerRow, ProductRow, UserRow } from "./types";
export const users: UserRow[] = active.users;
export const products: ProductRow[] = active.products;
export const customers: CustomerRow[] = active.customers;
