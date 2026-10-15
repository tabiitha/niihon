import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiMajorVersion, apiVersion } from '../src/contract/conventions.ts';
import { registeredModules } from '../src/modules/registry.ts';
import { exampleModule } from '../test/fixtures/example-module.ts';
import { buildOpenApiDocument } from './openapi.ts';

/**
 * Generates the published contract and both clients from the server's operation declarations:
 *
 *   node contract/generate.ts [--check] [--skip-swift]
 *
 * Everything is first written to a temporary directory. Without `--check`, the results replace
 * the committed files; with it, nothing is written and any difference is a drift (exit code 1).
 * `--skip-swift` leaves the Swift sources out, for machines without a Swift toolchain.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const check = process.argv.includes('--check');
const skipSwift = process.argv.includes('--skip-swift');

interface Contract {
  /** OpenAPI document, relative to the repository root. */
  readonly document: string;
  readonly title: string;
  readonly modules: Parameters<typeof buildOpenApiDocument>[0]['modules'];
  readonly typescript: string;
  readonly swiftDirectory: string;
}

const contracts: readonly Contract[] = [
  {
    document: 'contracts/openapi.json',
    title: 'Nihon API',
    modules: registeredModules,
    typescript: 'contracts/typescript/src/schema.ts',
    swiftDirectory: 'contracts/swift/Sources/NihonAPIClient/Generated',
  },
  {
    document: 'contracts/fixtures/openapi.json',
    title: 'Nihon API conformance fixture',
    modules: [exampleModule],
    typescript: 'contracts/typescript/test/conformance-schema.ts',
    swiftDirectory: 'contracts/swift/Sources/NihonAPIConformance/Generated',
  },
];

const generatedNotice = 'Generated from contracts/openapi.json. Do not edit: run `bun run contract:generate`.';

const work = mkdtempSync(join(tmpdir(), 'nihon-contract-'));
try {
  const files = generate(work);
  const differences = check ? compare(work, files) : (replace(work, files), []);
  if (differences.length > 0) {
    console.error(`Contract drift: the committed files differ from the declarations.\n${differences.map((line) => `  ${line}`).join('\n')}`);
    console.error('Run `bun run contract:generate` and commit the result.');
    process.exitCode = 1;
  } else {
    console.log(check ? 'Contract and generated clients are up to date.' : 'Contract and generated clients written.');
  }
  if (skipSwift) {
    console.log('Swift client skipped (--skip-swift).');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** Writes every generated file under `work` and returns their repository-relative paths. */
function generate(work: string): string[] {
  const files: string[] = [];
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), content);
    files.push(path);
  };

  write(
    'contracts/typescript/src/version.ts',
    `// ${generatedNotice}\n\nexport const apiVersion = '${apiVersion}';\nexport const apiMajorVersion = ${apiMajorVersion};\n`,
  );
  if (!skipSwift) {
    write(
      'contracts/swift/Sources/NihonAPIClient/Generated/NihonAPIVersion.swift',
      `// ${generatedNotice}\n\n/// Version of the contract this client was generated from.\npublic enum NihonAPIVersion {\n    public static let version = "${apiVersion}"\n    public static let major = ${apiMajorVersion}\n}\n`,
    );
  }

  for (const contract of contracts) {
    write(contract.document, `${JSON.stringify(buildOpenApiDocument(contract), null, 2)}\n`);
    mkdirSync(dirname(join(work, contract.typescript)), { recursive: true });
    run(process.execPath, [join(root, 'contracts/generator/typescript.mjs'), join(work, contract.document), join(work, contract.typescript)]);
    files.push(contract.typescript);
    if (!skipSwift) {
      const output = join(work, contract.swiftDirectory);
      mkdirSync(output, { recursive: true });
      run('swift', [
        'run',
        '--quiet',
        '--package-path',
        join(root, 'contracts/swift/Generator'),
        'swift-openapi-generator',
        'generate',
        '--config',
        join(root, 'contracts/swift/openapi-generator-config.yaml'),
        '--output-directory',
        output,
        join(work, contract.document),
      ]);
      files.push(...readdirSync(output).map((name) => `${contract.swiftDirectory}/${name}`));
    }
  }
  return [...new Set(files)].sort();
}

/** Directories whose whole content is generated: a committed file the generator no longer produces is stale. */
function generatedDirectories(): string[] {
  return skipSwift ? [] : contracts.map((contract) => contract.swiftDirectory);
}

function compare(work: string, files: readonly string[]): string[] {
  const differences: string[] = [];
  for (const path of files) {
    const committed = join(root, path);
    if (!existsSync(committed)) {
      differences.push(`missing: ${path}`);
    } else if (normalize(readFileSync(committed, 'utf8')) !== normalize(readFileSync(join(work, path), 'utf8'))) {
      differences.push(`outdated: ${path}`);
    }
  }
  for (const path of staleFiles(files)) {
    differences.push(`not generated: ${path}`);
  }
  return differences;
}

function replace(work: string, files: readonly string[]): void {
  for (const path of staleFiles(files)) {
    rmSync(join(root, path));
  }
  for (const path of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), readFileSync(join(work, path)));
  }
}

function staleFiles(files: readonly string[]): string[] {
  const generated = new Set(files);
  return generatedDirectories().flatMap((directory) =>
    existsSync(join(root, directory))
      ? readdirSync(join(root, directory))
          .map((name) => `${directory}/${name}`)
          .filter((path) => !generated.has(path))
      : [],
  );
}

/** Git may check text files out with CRLF line endings on Windows. */
function normalize(content: string): string {
  return content.replaceAll('\r\n', '\n');
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined || result.status !== 0) {
    const reason = result.error?.message ?? `exit code ${String(result.status)}`;
    throw new Error(
      `${command} ${args.join(' ')} failed (${reason}).\n${result.stdout}${result.stderr}` +
        (command === 'swift' && result.error !== undefined ? '\nInstall a Swift toolchain or pass --skip-swift.' : ''),
    );
  }
}
