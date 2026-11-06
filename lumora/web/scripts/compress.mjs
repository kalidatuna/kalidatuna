// Pre-compresses build output so the Rust server can serve .br/.gz files directly.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const root = new URL('../dist/', import.meta.url).pathname;
const exts = /\.(js|css|html|svg|json|txt|xml|webmanifest)$/;
let n = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (exts.test(name) && statSync(p).size > 1024) {
      const buf = readFileSync(p);
      writeFileSync(p + '.br', brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      writeFileSync(p + '.gz', gzipSync(buf, { level: 9 }));
      n++;
    }
  }
}
walk(root);
console.log(`compressed ${n} files`);
