// Callee audit: every bare-identifier call site in app.js/db.js/data.js/plangen.js
// must resolve to a function declared/assigned somewhere in those files, a browser
// global, or a known library. Reports unresolved callees (typo'd/renamed functions).
const fs = require('fs');
const acorn = require('acorn');
const walk = require('acorn-walk');

const FILES = ['app.js', 'db.js', 'data.js', 'plangen.js'];
const defined = new Set();
const called = new Map(); // name -> [file:line]

const BROWSER = new Set(['fetch','setTimeout','setInterval','clearTimeout','clearInterval','requestAnimationFrame','cancelAnimationFrame','alert','confirm','prompt','atob','btoa','structuredClone','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','encodeURI','decodeURI','String','Number','Boolean','Array','Object','Date','RegExp','Error','TypeError','RangeError','Promise','Map','Set','WeakMap','WeakSet','Proxy','Symbol','BigInt','JSON','Math','Intl','URL','URLSearchParams','Blob','File','FileReader','FormData','AbortController','TextEncoder','TextDecoder','Uint8Array','Int8Array','Uint16Array','Int32Array','Float32Array','Float64Array','ArrayBuffer','DataView','Image','Audio','Notification','CustomEvent','Event','MutationObserver','IntersectionObserver','ResizeObserver','Worker','crypto','queueMicrotask','print','open','close','focus','scrollTo','getComputedStyle','matchMedia','indexedDB','localStorage','sessionStorage','navigator','location','history','screen','performance','console','eval','isSecureContext','WebSocket','XMLHttpRequest','DOMParser','XMLSerializer','Option','Function','globalThis','escape','unescape','reportError','EventSource','BroadcastChannel','Path2D','OffscreenCanvas','ImageData','createImageBitmap','DOMPoint','DOMRect','ClipboardItem','showSaveFilePicker','showOpenFilePicker']);
const LIBS = new Set(['supabase','XLSX','Chart','JSZip','html2canvas','jspdf']);

for (const f of FILES) {
  const src = fs.readFileSync(f, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2023, locations: true });
  walk.simple(ast, {
    FunctionDeclaration(n) { if (n.id) defined.add(n.id.name); },
    VariableDeclarator(n) { if (n.id.type === 'Identifier') defined.add(n.id.name); },
    ClassDeclaration(n) { if (n.id) defined.add(n.id.name); },
    AssignmentExpression(n) {
      if (n.left.type === 'Identifier') defined.add(n.left.name);
      if (n.left.type === 'MemberExpression' && n.left.object.type === 'Identifier' &&
          (n.left.object.name === 'window' || n.left.object.name === 'globalThis') &&
          n.left.property.type === 'Identifier') defined.add(n.left.property.name);
    },
    ImportDeclaration(n) { n.specifiers.forEach(s => defined.add(s.local.name)); },
  });
  // params and catch bindings can shadow; collect them as defined too (coarse but avoids false positives)
  walk.full(ast, (n) => {
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
      n.params.forEach(function collect(p) {
        if (p.type === 'Identifier') defined.add(p.name);
        else if (p.type === 'AssignmentPattern') collect(p.left);
        else if (p.type === 'RestElement') collect(p.argument);
        else if (p.type === 'ObjectPattern') p.properties.forEach(pr => collect(pr.value || pr.argument));
        else if (p.type === 'ArrayPattern') p.elements.filter(Boolean).forEach(collect);
      });
    }
    if (n.type === 'CatchClause' && n.param && n.param.type === 'Identifier') defined.add(n.param.name);
  });
}
for (const f of FILES) {
  const src = fs.readFileSync(f, 'utf8');
  const ast = acorn.parse(src, { ecmaVersion: 2023, locations: true });
  walk.simple(ast, {
    CallExpression(n) {
      if (n.callee.type === 'Identifier') {
        const name = n.callee.name;
        if (!defined.has(name) && !BROWSER.has(name) && !LIBS.has(name)) {
          if (!called.has(name)) called.set(name, []);
          called.get(name).push(`${f}:${n.loc.start.line}`);
        }
      }
    },
    NewExpression(n) {
      if (n.callee.type === 'Identifier') {
        const name = n.callee.name;
        if (!defined.has(name) && !BROWSER.has(name) && !LIBS.has(name)) {
          if (!called.has(name)) called.set(name, []);
          called.get(name).push(`${f}:${n.loc.start.line} (new)`);
        }
      }
    },
  });
}
if (called.size === 0) { console.log('CALLEE AUDIT: CLEAN — every callee resolves.'); process.exit(0); }
console.log('CALLEE AUDIT: ' + called.size + ' unresolved callee name(s):');
for (const [name, sites] of called) console.log('  ' + name + '  @ ' + sites.slice(0, 5).join(', ') + (sites.length > 5 ? ` (+${sites.length - 5} more)` : ''));
process.exit(1);
