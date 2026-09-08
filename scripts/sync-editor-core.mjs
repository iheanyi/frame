import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv.find((argument) => argument.startsWith('--web='))?.slice(6);
if (!target) throw new Error('Usage: node scripts/sync-editor-core.mjs --web=/path/to/frame-web [--check]');
const source = await readFile(new URL('../packages/editor-core/index.ts', import.meta.url), 'utf8');
const hash = createHash('sha256').update(source).digest('hex');
const generated = `// Generated from Frame desktop packages/editor-core/index.ts. Do not edit.\n// source-sha256: ${hash}\n${source}`;
const destination = resolve(target, 'lib/editor-core.ts');
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== generated) throw new Error('Web editor-core differs from canonical source. Run the sync command before deployment.');
  console.log(`Shared editor-core verified: ${hash}`);
} else {
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, generated);
  console.log(`Updated ${destination} from ${fileURLToPath(new URL('../packages/editor-core/index.ts', import.meta.url))}`);
}
