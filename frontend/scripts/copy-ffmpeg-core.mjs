// Copies the browser FFmpeg engine (WebAssembly) into public/ffmpeg so it is served from our own
// origin. It is ~32 MB, so it is generated at install/build time instead of being committed.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const to = join(root, 'public', 'ffmpeg');

if (!existsSync(from)) {
  console.warn('[copy-ffmpeg-core] @ffmpeg/core is not installed; browser audio extraction will fall back to the server.');
  process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const f of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(join(from, f), join(to, f));
console.log('[copy-ffmpeg-core] engine copied to public/ffmpeg');
