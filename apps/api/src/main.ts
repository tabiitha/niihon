import { readFileSync } from 'node:fs';

import { ConfigError, loadConfig } from './config.ts';
import { DataDirectoryInUseError } from './instance-lock.ts';
import { createJsonLogger, type Logger } from './log.ts';
import { selectEnabledModules } from './modules/enablement.ts';
import { registeredModules } from './modules/registry.ts';
import { startServer } from './server.ts';
import { assertWebDir } from './web.ts';

/** Process exit codes, documented in docs/architecture/api-server.md. */
const exitCodes = {
  stopped: 0,
  failed: 1,
  invalidConfig: 2,
  dataDirectoryInUse: 3,
} as const;

async function main(logger: Logger): Promise<number> {
  let config;
  let modules;
  try {
    config = loadConfig(process.env, process.cwd());
    modules = selectEnabledModules(registeredModules, config.enabledModuleIds);
    if (config.webDir !== undefined) {
      assertWebDir(config.webDir);
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      logger('error', 'config.invalid', { message: error.message });
      return exitCodes.invalidConfig;
    }
    throw error;
  }

  const version = readVersion();
  let server;
  try {
    server = await startServer({ ...config, version, modules, logger });
  } catch (error) {
    if (error instanceof DataDirectoryInUseError) {
      logger('error', 'instance.refused', { dataDir: error.dataDir, message: error.message });
      return exitCodes.dataDirectoryInUse;
    }
    throw error;
  }

  logger('info', 'server.listening', {
    host: server.host,
    port: server.port,
    version,
    dataDir: config.dataDir,
    webDir: config.webDir ?? null,
    modules: modules.map((module) => module.id),
  });

  const signal = await waitForStopSignal((repeated) => {
    logger('warn', 'server.forced_exit', { signal: repeated });
    process.exit(exitCodes.failed);
  });
  logger('info', 'server.stopping', { signal });
  await server.stop();
  logger('info', 'server.stopped');
  return exitCodes.stopped;
}

function readVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || !('version' in manifest) || typeof manifest.version !== 'string') {
    throw new Error('apps/api/package.json has no version.');
  }
  return manifest.version;
}

/** Resolves on the first SIGINT or SIGTERM; a second signal forces an immediate exit. */
function waitForStopSignal(onRepeat: (signal: NodeJS.Signals) => void): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    let received = false;
    const handle = (signal: NodeJS.Signals) => {
      if (received) {
        onRepeat(signal);
        return;
      }
      received = true;
      resolve(signal);
    };
    process.on('SIGINT', handle);
    process.on('SIGTERM', handle);
  });
}

const logger = createJsonLogger();
main(logger).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    logger('error', 'server.failed', { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = exitCodes.failed;
  },
);
