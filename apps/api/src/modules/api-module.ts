import type { Router } from 'express';

import type { OperationContract } from '../contract/operation.ts';

/**
 * Entry point of one feature module. The module owns everything under `/api/<id>/`;
 * `register` adds its routes to the router mounted there, each through
 * `addOperation(router, operation).handle(...)` with a declaration listed in `operations`,
 * from which the published contract is generated.
 */
export interface ApiModule {
  readonly id: string;
  readonly operations: readonly OperationContract[];
  register(router: Router): void;
}
