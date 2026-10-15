import type { ApiModule } from './api-module.ts';

/**
 * Every feature module compiled into the server. Add one import and one entry per module,
 * keeping the list sorted by identifier. `NIHON_MODULES` selects which of them are enabled.
 */
export const registeredModules: readonly ApiModule[] = [];
