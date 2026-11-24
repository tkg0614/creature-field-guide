// 機械で直せる誤りを直す（AI を使わない）。node tools/fix.js <id...>  → 直した数を出す
//  1) 動詞・形容詞の後ろの「である。」（Groq の texts が「移動するである。」と書く）→「移動する。」
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const VERB_DEARU = /([うくぐすつぬぶむるただい])である(。|$)/g;
function fixStr(t, n) { return t.replace(VERB_DEARU, (m, a, b) => { n.c++; return a + b; }); }
function walk(o, n) {
  if (typeof o === 'string') return fixStr(o, n);
  if (Array.isArray(o)) return o.map((v) => walk(v, n));
  if (o && typeof o === 'object') { for (const k of Object.keys(o)) if (k !== 'quote') o[k] = walk(o[k], n); return o; }
  return o;
}
module.exports = { walk, VERB_DEARU };
if (require.main === module) for (const id of process.argv.slice(2)) {
  const p = path.join(ROOT, 'sheets', `${id}.json`), S = JSON.parse(fs.readFileSync(p, 'utf8')), n = { c: 0 };
  walk(S, n); if (n.c) fs.writeFileSync(p, JSON.stringify(S, null, 1) + '\n');
  console.log(`${id}: ${n.c}`);
}
