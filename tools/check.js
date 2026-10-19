// 素材の表の検査（コードだけ）。node tools/check.js <id...>  → ✓/✗
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const E = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'earth_land.json'), 'utf8'));
const bits = Buffer.from(E.bits, 'base64');
const isLand = (lat, lon) => { const r = Math.floor((90 - lat) / 1.5), c = Math.floor((((lon + 180) % 360 + 360) % 360) / 1.5); return r >= 0 && r < E.h && ((bits[(r * E.w + c) >> 3] >> ((r * E.w + c) & 7)) & 1) === 1; };
const KINDS = ['bird', 'fish', 'mammal', 'reptile', 'amphibian', 'insect', 'arachnid', 'crustacean', 'mollusc', 'human', 'any'];
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function strings(o, out = []) { if (typeof o === 'string') out.push(o); else if (o && typeof o === 'object') for (const v of Object.values(o)) strings(v, out); return out; }

// part: 一部だけ調べる時の欄の名前（工場が段ごとに使う）。無ければ全部
function validate(S, src = '', part = null) {
  const err = [], warn = [], has = (k) => !part || part.includes(k);
  const places = (S.places || []).map((p) => p.id), stages = (S.stages || []).map((s) => s.id);
  const refP = (list, at) => arr(list).forEach((p) => places.includes(p) || err.push(`${at}: 場所「${p}」が places に無い`));
  const refS = (list, at) => arr(list).forEach((s) => stages.includes(s) || err.push(`${at}: 段「${s}」が stages に無い`));
  if (has('places')) {
    const R = S.region || {};
    for (const k of ['lon0', 'lon1', 'lat0', 'lat1', 'k']) if (typeof R[k] !== 'number') err.push(`region.${k} が数でない`);
    if (!(places.length >= 5 && places.length <= 9)) err.push(`places は5〜9か所（いま${places.length}）`);
    for (const p of S.places || []) {
      const at = `places.${p.id}`;
      for (const k of ['id', 'ja', 'about']) if (!p[k]) err.push(`${at}: ${k} が無い`);
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number') { err.push(`${at}: lat/lon が数でない`); continue; }
      if (p.lat > R.lat0 || p.lat < R.lat1 || p.lon < R.lon0 || p.lon > R.lon1) err.push(`${at}: 地域の地図（region）の外にある`);
      if (!(p.danger >= 0 && p.danger <= 3)) err.push(`${at}: danger は 0〜3`);
      if (p.sea && isLand(p.lat, p.lon)) warn.push(`${at}: 海の場所なのに陸の上（1.5度の粗い地図で）`);
      if (stages.length) refS(p.stages, at);
    }
    const seen = new Set([places[0]]); let grow = true;
    while (grow) { grow = false; for (const [a, b] of S.edges || []) { if (seen.has(a) && !seen.has(b)) { seen.add(b); grow = true; } if (seen.has(b) && !seen.has(a)) { seen.add(a); grow = true; } } }
    for (const e of S.edges || []) refP(e, 'edges');
    if (seen.size < places.length) err.push(`edges: つながっていない場所がある（${places.filter((p) => !seen.has(p)).join(', ')}）`);
    if (S.start) refP(S.start.place, 'start');
  }
  if (has('life')) {
    if (!(stages.length >= 3 && stages.length <= 5)) err.push('stages は3〜5個');
    if (!(S.stages || []).some((s) => s.adult)) err.push('stages の最後に "adult": true');
    (S.stages || []).forEach((s, i) => { if (i && !(s.fromAge > 0)) err.push(`stages.${s.id}: fromAge（年）が無い`); if (!(s.days > 0)) err.push(`stages.${s.id}: days が無い`); });
    if (!S.oldAge || arr(S.oldAge.years).length !== 2) err.push('oldAge.years は [最短, 最長]');
    for (const k of ['run', 'sense', 'forage']) if (!S.stats || !S.stats[k] || !S.stats[k].ja) err.push(`stats.${k} が無い`);
    const B = S.breeding || {};
    for (const k of ['ja', 'ds', 'months', 'places', 'kids', 'many', 'label', 'ok', 'ng']) if (B[k] == null) err.push(`breeding.${k} が無い`);
    refP(B.places, 'breeding');
    if (!(S.foods || []).length) err.push('foods が無い');
    for (const f of S.foods || []) { refP(f.places, `foods.${f.id}`); refS(f.stages, `foods.${f.id}`); refP(f.rich, `foods.${f.id}.rich`); }
  }
  if (has('foes')) {
    if (!((S.foes || []).length >= 8 && S.foes.length <= 14)) err.push(`foes は8〜14体（いま${(S.foes || []).length}）`);
    if ((S.foes || []).filter((f) => f.again).length < 2) err.push('宿敵（again のある天敵）が2体以上要る');
    for (const f of S.foes || []) {
      const at = `foes.${f.id}`;
      refP(f.places, at); refS(f.stages, at);
      if (!KINDS.includes(f.kind)) err.push(`${at}: kind は ${KINDS.join('/')}`);
      if (!(f.sev >= 1 && f.sev <= 3)) err.push(`${at}: sev は 1〜3`);
      if (!arr(f.texts).length) err.push(`${at}: texts が無い`);
      if (f.kind === 'human' && !f.lose) err.push(`${at}: 人の危険には lose（負けた時の文。「傷を負った。」で終える）`);
      if (f.lose && !/傷を負った。$/.test(f.lose)) err.push(`${at}: lose は「傷を負った。」で終える`);
    }
  }
  if (has('choices')) {
    if ((S.choices || []).length < 3) err.push('choices は3つ以上');
    for (const [i, c] of (S.choices || []).entries()) {
      if (!c.q || arr(c.opts).length < 2) err.push(`choices[${i}]: q と2つ以上の opts`);
      refS(c.stages, `choices[${i}]`);
      for (const o of arr(c.opts)) { if (!o.ja || !o.ds || !o.say) err.push(`choices[${i}]: opts に ja・ds・say`); if (o.goto) refP(o.goto, `choices[${i}].goto`); for (const v of Object.values(o.fx || {})) if (!(v >= -1 && v <= 1)) err.push(`choices[${i}]: fx は −1〜1`); }
    }
  }
  // 言葉の決まり
  for (const t of strings(part ? Object.fromEntries(Object.entries(S).filter(([k]) => ['places', 'life', 'foes', 'choices', 'texts'].some((p) => has(p)))) : S)) {
    if (/です|ます[。、]|ました/.test(t)) err.push(`言葉: だ・である調にする「${t.slice(0, 30)}」`);
    if (/[!！?？]$/.test(t) && !/^(q|.*か)$/.test(t)) { /* 問いの q は「〜か」で終える */ }
    if (/[!！]$/.test(t)) err.push(`言葉: 感嘆符で終えない「${t.slice(0, 30)}」`);
  }
  for (const f of S.facts || []) if (src && f.quote && !src.includes(f.quote)) warn.push(`facts: 資料に無い引用「${String(f.quote).slice(0, 30)}」`);
  return { errors: [...new Set(err)], warnings: warn };
}
module.exports = { validate, isLand };
if (require.main === module) {
  let bad = 0;
  for (const id of process.argv.slice(2)) {
    const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'sheets', `${id}.json`), 'utf8'));
    const dir = path.join(ROOT, 'sources', id), src = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') : '';
    const r = validate(S, src); if (r.errors.length) bad++;
    console.log(`■ ${id} ${r.errors.length ? '✗' : '✓'}`); r.errors.forEach((e) => console.log('  ✗', e)); r.warnings.forEach((w) => console.log('  △', w));
  }
  process.exit(bad ? 1 : 0);
}
