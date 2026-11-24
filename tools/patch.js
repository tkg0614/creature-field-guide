// 検品の直しを表へ当てる。node tools/patch.js <edits.json>
//  edits.json = { "<id>": { "set": {"foes.3.sev": 2, "stages.1.ja": "幼獣"}, "del": ["happen.2"], "push": {"foes": {...}}, "note": "直した理由" } }
//  道は digest.js の [番号]。del は後ろの番号から消す。当てた後に check.js が緑なら status=reviewed にし、data/review_log.tsv に1行。
//  緑でなければその種は書き戻さない（✗ を出す）。"hold": true なら直しだけ当てて checked のまま。
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), { validate } = require('./check.js'), { walk } = require('./fix.js');
const E = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const seg = (p) => p.split('.').map((k) => (/^\d+$/.test(k) ? +k : k));
function at(o, ks, make) { for (const k of ks) { if (o[k] == null && make) o[k] = {}; o = o[k]; if (o == null) throw Error('道が無い'); } return o; }
let bad = 0;
for (const [id, e] of Object.entries(E)) {
  const p = path.join(ROOT, 'sheets', `${id}.json`), S = JSON.parse(fs.readFileSync(p, 'utf8'));
  let n = 0;
  try {
    for (const [k, v] of Object.entries(e.set || {})) { const ks = seg(k), last = ks.pop(); at(S, ks, true)[last] = v; n++; }
    for (const [k, v] of Object.entries(e.push || {})) { const t = at(S, seg(k)); for (const x of [].concat(v)) t.push(x); n += [].concat(v).length; }
    const dels = (e.del || []).map(seg).sort((x, y) => (x.length === y.length ? y[y.length - 1] - x[x.length - 1] : 0));
    for (const ks of dels) { const last = ks.pop(), t = at(S, ks); if (Array.isArray(t)) t.splice(last, 1); else delete t[last]; n++; }
  } catch (x) { console.log(`✗ ${id}: ${x.message}`); bad++; continue; }
  walk(S, { c: 0 });
  const r = validate(S);
  if (r.errors.length) { console.log(`✗ ${id}（書き戻さない）\n  ` + r.errors.join('\n  ')); bad++; continue; }
  if (!e.hold) S.status = 'reviewed';
  fs.writeFileSync(p, JSON.stringify(S, null, 1) + '\n');
  if (!e.hold) fs.appendFileSync(path.join(ROOT, 'data', 'review_log.tsv'), `${new Date().toISOString().slice(0, 10)}\t${id}\t${n}\t${(e.note || '').replace(/\s+/g, ' ')}\n`);
  console.log(`✓ ${id}: ${n}件${e.hold ? '（checked のまま）' : ' → reviewed'}`);
}
process.exit(bad ? 1 : 0);
