import type { Router } from 'express';

import type { OperationContract } from '../contract/operation.ts';
import type { Database } from '../database/database.ts';

/** Services the server hands to every module when registering its routes. */
export interface ModuleContext {
  /** The installation database; modules read through `reader` and write through `write`. */
  readonly database: Database;
}

/**
 * Entry point of one feature module. The module owns everything under `/api/<id>/`;
 * `register` adds its routes to the router mounted there, each through
 * `addOperation(router, operation).handle(...)` with a declaration listed in `operations`,
 * from which the published contract is generated.
 */
export interface ApiModule {
  readonly id: string;
  readonly operations: readonly OperationContract[];
  register(router: Router, context: ModuleContext): void;
}
