import type { Router } from 'express';

/**
 * Entry point of one feature module. The module owns everything under `/api/<id>/`;
 * `register` adds its routes to the router mounted there.
 */
export interface ApiModule {
  readonly id: string;
  register(router: Router): void;
}
