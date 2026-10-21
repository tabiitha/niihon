import type { Router } from 'express';

import type { OAuthSettings } from '../config.ts';
import type { OperationContract } from '../contract/operation.ts';
import type { Database } from '../database/database.ts';
import type { Logger } from '../log.ts';

/** Services the server hands to every module when registering its routes. */
export interface ModuleContext {
  /** The installation database; modules read through `reader` and write through `write`. */
  readonly database: Database;
  /** The server log; never pass it credentials or request bodies. */
  readonly logger: Logger;
  /** Provider credentials and return addresses configured for this installation. */
  readonly oauth: OAuthSettings;
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
