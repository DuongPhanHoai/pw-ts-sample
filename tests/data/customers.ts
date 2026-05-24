/**
 * Environment-aware resolver. Re-exports the active environment's customer set.
 * To change envs, set TEST_ENV (see tests/config/env.ts).
 */

import type { Env } from "../config/env";
import { getEnv } from "../config/env";
import type { CustomerRow } from "./types";
import { customers as devCustomers } from "./dev/customers";
import { customers as testCustomers } from "./test/customers";
import { customers as stgCustomers } from "./stg/customers";
import { customers as prdCustomers } from "./prd/customers";

const byEnv: Record<Env, CustomerRow[]> = {
  dev: devCustomers,
  test: testCustomers,
  stg: stgCustomers,
  prd: prdCustomers,
};

export type { CustomerRow } from "./types";
export const customers: CustomerRow[] = byEnv[getEnv()];
