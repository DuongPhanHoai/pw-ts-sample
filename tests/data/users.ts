/**
 * Environment-aware resolver. Re-exports the active environment's user set so
 * specs can keep importing from `./data/users` without knowing about envs.
 *
 * To change envs, set TEST_ENV (see tests/config/env.ts).
 */

import type { Env } from "../config/env";
import { getEnv } from "../config/env";
import type { UserRow } from "./types";
import { users as devUsers } from "./dev/users";
import { users as testUsers } from "./test/users";
import { users as stgUsers } from "./stg/users";
import { users as prdUsers } from "./prd/users";

const byEnv: Record<Env, UserRow[]> = {
  dev: devUsers,
  test: testUsers,
  stg: stgUsers,
  prd: prdUsers,
};

export type { UserRow } from "./types";
export const users: UserRow[] = byEnv[getEnv()];
