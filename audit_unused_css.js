// Unused-CSS scan: extract every class and id selector from styles.css, then check
// whether the bare name appears anywhere in index.html, app.js, db.js, or plangen.js
// (covers class="...", classList ops, template literals, and getElementById).
// Conservative: a name appearing anywhere counts as used, so anything reported is
// a strong dead-selector candidate.
const fs = require('fs');
const css = fs.readFileSync('styles.css', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');           // strip comments
// take selector text: everything before each '{' that isn't inside a block
const selectors = new Set();
const re = /([^{}]+)\{/g;
let m;
while ((m = re.exec(css))) {
  const sel = m[1];
  if (sel.includes('@')) continue;              // @media/@keyframes headers
  let t;
  const classRe = /\.([A-Za-z_-][\w-]*)/g;
  while ((t = classRe.exec(sel))) selectors.add('.' + t[1]);
  const idRe = /#([A-Za-z_-][\w-]*)/g;
  while ((t = idRe.exec(sel))) selectors.add('#' + t[1]);
}
const hay = ['index.html', 'app.js', 'db.js', 'plangen.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
const unused = [];
for (const s of selectors) {
  const name = s.slice(1);
  const wordRe = new RegExp('\\b' + name.replace(/[-]/g, '\\-') + '\\b');
  if (!wordRe.test(hay)) unused.push(s);
}
console.log('Selectors extracted: ' + selectors.size + ' (' + [...selectors].filter(s => s[0] === '.').length + ' classes, ' + [...selectors].filter(s => s[0] === '#').length + ' ids)');
if (!unused.length) console.log('UNUSED-CSS SCAN: none — every class/id selector name appears in HTML/JS.');
else { console.log('UNUSED (' + unused.length + '):'); unused.sort().forEach(u => console.log('  ' + u)); }
