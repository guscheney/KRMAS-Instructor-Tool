// Unreferenced-function sweep: top-level function declarations in app.js that are
// never referenced (call, handler string, or identifier use) anywhere in app.js,
// db.js, plangen.js, index.html, or the test files.
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

const src = fs.readFileSync('app.js', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 2023, locations: true });
const topFns = [];
for (const node of ast.body) {
  if (node.type === 'FunctionDeclaration' && node.id) topFns.push({ name: node.id.name, line: node.loc.start.line });
}
const hay = ['app.js', 'db.js', 'plangen.js', 'index.html', ...fs.readdirSync('.').filter(f => f.startsWith('jsdom_') && f.endsWith('.js'))]
  .map(f => fs.readFileSync(f, 'utf8')).join('\n');
const dead = [];
for (const fn of topFns) {
  // count occurrences of the bare name as a word; the declaration itself accounts for 1
  const re = new RegExp('\\b' + fn.name.replace(/[$]/g, '\\$') + '\\b', 'g');
  const count = (hay.match(re) || []).length;
  if (count <= 1) dead.push(fn);
}
console.log('Top-level app.js functions: ' + topFns.length);
if (!dead.length) console.log('DEAD-FUNCTION SWEEP: none — every top-level function is referenced at least once.');
else { console.log('UNREFERENCED (' + dead.length + '):'); dead.forEach(d => console.log('  ' + d.name + '  @ app.js:' + d.line)); }
