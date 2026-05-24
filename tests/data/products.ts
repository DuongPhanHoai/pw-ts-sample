/**
 * Environment-aware resolver. Re-exports the active environment's product set.
 * To change envs, set TEST_ENV (see tests/config/env.ts).
 */

import type { Env } from "../config/env";
import { getEnv } from "../config/env";
import type { ProductRow } from "./types";
import { products as devProducts } from "./dev/products";
import { products as testProducts } from "./test/products";
import { products as stgProducts } from "./stg/products";
import { products as prdProducts } from "./prd/products";

const byEnv: Record<Env, ProductRow[]> = {
  dev: devProducts,
  test: testProducts,
  stg: stgProducts,
  prd: prdProducts,
};

export type { ProductRow } from "./types";
export const products: ProductRow[] = byEnv[getEnv()];
