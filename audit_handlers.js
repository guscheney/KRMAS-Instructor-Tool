// Handler-name audit: every function referenced in inline event handlers
// (onclick="fn(...)" etc.) — in index.html AND in HTML template literals inside
// app.js — must exist as a global function in app.js/db.js/data.js/plangen.js.
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

const JS_FILES = ['app.js', 'db.js', 'data.js', 'plangen.js'];
const defined = new Set();
for (const f of JS_FILES) {
  const ast = acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 2023 });
  walk.simple(ast, {
    FunctionDeclaration(n) { if (n.id) defined.add(n.id.name); },
    VariableDeclarator(n) { if (n.id.type === 'Identifier') defined.add(n.id.name); },
    AssignmentExpression(n) {
      if (n.left.type === 'Identifier') defined.add(n.left.name);
      if (n.left.type === 'MemberExpression' && n.left.object.type === 'Identifier' &&
          (n.left.object.name === 'window' || n.left.object.name === 'globalThis') &&
          n.left.property.type === 'Identifier') defined.add(n.left.property.name);
    },
  });
}
// Sources of inline handlers: raw index.html + every string/template literal in app.js
const sources = [{ name: 'index.html', text: fs.readFileSync('index.html', 'utf8') }];
{
  const src = fs.readFileSync('app.js', 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2023, locations: true });
  walk.simple(ast, {
    TemplateLiteral(n) { n.quasis.forEach(q => sources.push({ name: 'app.js:' + n.loc.start.line, text: q.value.cooked || '' })); },
    Literal(n) { if (typeof n.value === 'string' && /on[a-z]+\s*=/.test(n.value)) sources.push({ name: 'app.js:' + n.loc.start.line, text: n.value }); },
  });
}
const HANDLER_RE = /\bon(?:click|change|input|submit|keyup|keydown|keypress|blur|focus|load|error|mouseover|mouseout|mousedown|mouseup|touchstart|touchend|dblclick|contextmenu|scroll|paste|drop|dragover|dragstart|dragend|dragleave|wheel|pointerdown|pointerup|toggle|close|invalid|search|animationend|transitionend)\s*=\s*(["'])([\s\S]*?)\1/gi;
const CALL_RE = /(?:^|[^\w.$])([A-Za-z_$][\w$]*)\s*\(/g;
const JS_KEYWORDS = new Set(['if','for','while','switch','return','function','catch','new','typeof','delete','void','in','of','this','event','arguments','async','await','JSON','String','Number','Boolean','Array','Object','Date','Math','parseInt','parseFloat','encodeURIComponent','decodeURIComponent','alert','confirm','prompt','setTimeout','clearTimeout','requestAnimationFrame','stopPropagation','preventDefault','console']);
const problems = new Map();
for (const s of sources) {
  let m;
  while ((m = HANDLER_RE.exec(s.text))) {
    const code = m[2];
    let c;
    while ((c = CALL_RE.exec(code))) {
      const name = c[1];
      if (JS_KEYWORDS.has(name) || defined.has(name)) continue;
      // member calls like foo.bar( are excluded by the regex's leading [^\w.$]; also skip event./this.
      if (!problems.has(name)) problems.set(name, []);
      problems.get(name).push(s.name);
    }
  }
}
if (problems.size === 0) { console.log('HANDLER-NAME AUDIT: CLEAN — every inline handler resolves to a global.'); process.exit(0); }
console.log('HANDLER-NAME AUDIT: ' + problems.size + ' unresolved handler function(s):');
for (const [name, sites] of problems) console.log('  ' + name + '  @ ' + [...new Set(sites)].slice(0, 5).join(', '));
process.exit(1);
