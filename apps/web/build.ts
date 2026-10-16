// Production build: bundles src/index.html and everything it imports into dist/, which the Express server
// serves (NIHON_WEB_DIR). Asset names carry a content hash, so they can be cached indefinitely.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outdir = fileURLToPath(new URL('dist/', import.meta.url));
rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL('src/index.html', import.meta.url))],
  outdir,
  publicPath: '/',
  target: 'browser',
  minify: true,
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
});

for (const log of result.logs) {
  console.error(log);
}
if (!result.success) {
  process.exit(1);
}
for (const output of result.outputs) {
  console.log(`${output.path.slice(outdir.length)}  ${(output.size / 1024).toFixed(1)} KiB`);
}
