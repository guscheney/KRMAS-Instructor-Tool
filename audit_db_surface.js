// DB surface audit: every DB.<x> / DB.<ns>.<x> reference in app.js (and plangen.js)
// must exist on the surface object that db.js exports/attaches. Also reports surface
// members that no caller uses (orphans) for the dead-code sweep.
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

const dbSrc = fs.readFileSync('db.js', 'utf8');
const dbAst = acorn.parse(dbSrc, { ecmaVersion: 2023, locations: true });

// Collect the surface: properties of the object literal(s) assigned to window.DB / const DB / return {...}
// Strategy: find object literals whose properties are mostly identifiers/shorthand and that are assigned
// into something named DB, plus nested namespace objects (e.g. DB.aquila = {...} or aquila: {...}).
const surface = new Set();       // "loadFeedPosts", "aquila.members", ...
function addProps(objExpr, prefix) {
  for (const p of objExpr.properties || []) {
    if (p.type !== 'Property') continue;
    const key = p.key.type === 'Identifier' ? p.key.name : (p.key.type === 'Literal' ? String(p.key.value) : null);
    if (!key) continue;
    surface.add(prefix + key);
    if (p.value && p.value.type === 'ObjectExpression') addProps(p.value, prefix + key + '.');
  }
}
walk.simple(dbAst, {
  AssignmentExpression(n) {
    // window.DB = {...} | DB = {...} | DB.ns = {...}
    const L = n.left;
    const isDbRoot = (L.type === 'Identifier' && L.name === 'DB') ||
      (L.type === 'MemberExpression' && L.property && L.property.name === 'DB');
    if (isDbRoot && n.right.type === 'ObjectExpression') addProps(n.right, '');
    if (L.type === 'MemberExpression' && L.object.type === 'Identifier' && L.object.name === 'DB' && L.property.type === 'Identifier') {
      surface.add(L.property.name);
      if (n.right.type === 'ObjectExpression') addProps(n.right, L.property.name + '.');
    }
  },
  VariableDeclarator(n) {
    if (n.id.type === 'Identifier' && n.id.name === 'DB' && n.init && n.init.type === 'ObjectExpression') addProps(n.init, '');
  },
  ReturnStatement(n) {
    if (n.argument && n.argument.type === 'ObjectExpression') addProps(n.argument, '');
  },
});

// Collect DB usages from app.js and plangen.js
const missing = new Map();
const used = new Set();
for (const f of ['app.js', 'plangen.js']) {
  const ast = acorn.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 2023, locations: true });
  walk.simple(ast, {
    MemberExpression(n) {
      // DB.x  or  DB.ns.x
      let path = [];
      let cur = n;
      while (cur.type === 'MemberExpression' && !cur.computed && cur.property.type === 'Identifier') {
        path.unshift(cur.property.name);
        cur = cur.object;
      }
      if (cur.type === 'Identifier' && cur.name === 'DB' && path.length) {
        const one = path[0];
        const two = path.length > 1 ? path[0] + '.' + path[1] : null;
        if (surface.has(one)) used.add(one);
        if (two && surface.has(two)) { used.add(two); used.add(one); }
        if (!surface.has(one) && !(two && surface.has(two))) {
          const key = two || one;
          if (!missing.has(key)) missing.set(key, []);
          missing.get(key).push(f + ':' + n.loc.start.line);
        }
      }
    },
  });
}
const orphans = [...surface].filter(s => !used.has(s) && !s.includes('.'));
console.log('DB SURFACE AUDIT');
console.log('  surface size: ' + surface.size + ' members');
if (missing.size) {
  console.log('  MISSING (called but not on surface): ' + missing.size);
  for (const [k, sites] of missing) console.log('    DB.' + k + '  @ ' + sites.slice(0, 4).join(', '));
} else console.log('  MISSING: none — every DB.* call resolves.');
if (orphans.length) {
  console.log('  ORPHANS (on surface, never called from app.js/plangen.js): ' + orphans.length);
  orphans.forEach(o => console.log('    DB.' + o));
} else console.log('  ORPHANS: none.');
process.exit(missing.size ? 1 : 0);
