import { ConfigError } from '../config.ts';
import type { ApiModule } from './api-module.ts';

/**
 * Returns the registered modules to enable, in registry order. `undefined` enables all of them;
 * an identifier that no registered module carries is a configuration error.
 */
export function selectEnabledModules(
  registered: readonly ApiModule[],
  enabledIds: readonly string[] | undefined,
): readonly ApiModule[] {
  const knownIds = new Set<string>();
  for (const module of registered) {
    if (knownIds.has(module.id)) {
      throw new Error(`Module "${module.id}" is registered more than once.`);
    }
    knownIds.add(module.id);
  }
  if (enabledIds === undefined) {
    return registered;
  }
  const unknownIds = enabledIds.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw new ConfigError(`NIHON_MODULES names unknown modules: ${unknownIds.join(', ')}.`);
  }
  const wanted = new Set(enabledIds);
  return registered.filter((module) => wanted.has(module.id));
}
