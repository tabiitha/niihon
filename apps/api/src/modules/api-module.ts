import type { Router } from 'express';

import type { Commands } from '../commands/idempotency.ts';
import type { OAuthSettings } from '../config.ts';
import type { OperationContract } from '../contract/operation.ts';
import type { Database } from '../database/database.ts';
import type { Logger } from '../log.ts';
import type { Sessions } from '../sessions/sessions.ts';

/** Services the server hands to every module when registering its routes. */
export interface ModuleContext {
  /** The installation database; modules read through `reader` and write through `write`. */
  readonly database: Database;
  /** Adds idempotent commands, whose response is stored with their effect under the client's key. */
  readonly commands: Commands;
  /**
   * Opens and revokes sign-in sessions. The session a request was authenticated with is
   * `currentSession(request)`; operations declaring `session: 'required'` refuse requests without one.
   */
  readonly sessions: Sessions;
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
