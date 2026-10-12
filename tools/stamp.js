// Version every module URL by its content so a deploy never mixes old and new files from the browser cache.
// Writes an import map into index.html and versions the entry script and stylesheets. Sources are never edited.
//   node tools/stamp.js          update index.html
//   node tools/stamp.js --check  exit 1 if index.html is stale (also run by the tests)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../..');
const START = '<script type="importmap">', END = '</script>';

function modules(dir = join(root, 'js')) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? modules(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
}

export function stamped(html) {
  const files = modules().sort();
  const v = f => createHash('sha1').update(readFileSync(f)).digest('hex').slice(0, 8);
  const imports = {};
  for (const f of files) { const p = './' + relative(root, f).split('\\').join('/'); imports[p] = `${p}?v=${v(f)}`; }
  const map = `${START}\n${JSON.stringify({ imports }, null, 2)}\n${END}`;
  const a = html.indexOf(START);
  html = a < 0
    ? html.replace('<script type="module"', `${map}\n<script type="module"`)
    : html.slice(0, a) + map + html.slice(html.indexOf(END, a) + END.length);
  html = html.replace(/<script type="module" src="js\/main\.js(\?v=\w+)?">/, `<script type="module" src="${imports['./js/main.js']}">`.replace('src="./', 'src="'));
  // stylesheets: version each <link href="css/…"> the same way
  return html.replace(/<link rel="stylesheet" href="(css\/[\w.-]+\.css)(\?v=\w+)?">/g, (_, f) => `<link rel="stylesheet" href="${f}?v=${v(join(root, f))}">`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(root, 'index.html'), html = readFileSync(file, 'utf8'), next = stamped(html);
  if (process.argv.includes('--check')) {
    if (next !== html) { console.error('index.html import map is stale: run `node tools/stamp.js`'); process.exit(1); }
    console.log('import map up to date');
  } else { writeFileSync(file, next); console.log('stamped', Object.keys(JSON.parse(next.split(START)[1].split(END)[0]).imports).length, 'modules'); }
}
