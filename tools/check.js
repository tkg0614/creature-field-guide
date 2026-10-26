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
    // apex: 自然の天敵がほとんどいない頂点捕食者（シャチ）。数合わせの架空の天敵を書かせないよう下限を下げる（2026-10-25）
    const fmin = S.apex ? 4 : 8, amin = S.apex ? 1 : 2;
    if (!((S.foes || []).length >= fmin && S.foes.length <= 14)) err.push(`foes は${fmin}〜14体（いま${(S.foes || []).length}）`);
    if ((S.foes || []).filter((f) => f.again).length < amin) err.push(`宿敵（again のある天敵）が${amin}体以上要る`);
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
  // ---- よく出る誤り（2026-10-25: 16種の検品で何度も直したもの。人が見る前に機械で見つける）
  const TYPES = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'types.json'), 'utf8')); } catch { return []; } })();
  const T = TYPES.find((t) => t.id === S.type);
  if (has('life') && (S.stages || []).length && S.oldAge && arr(S.oldAge.years).length === 2) {
    const st = S.stages, [o0, o1] = S.oldAge.years;
    st.forEach((s, i) => {
      if (!s.ja) err.push(`stages.${s.id}: ja（段の名前）が無い`);
      const a = i ? s.fromAge : 0, next = i + 1 < st.length ? st[i + 1].fromAge : o0;
      if (i && st[i - 1].fromAge != null && !(a > (i - 1 ? st[i - 1].fromAge : 0))) err.push(`stages.${s.id}: fromAge が前の段より大きくない`);
      // 1手の日数 days が段の長さより長い＝段を1手で飛び越す（krill 300日・orca 1095日・spider 卵150日）。細かな手数は pack_build の pace() がそろえる
      const span = ((i + 1 < st.length ? next : o1) - a) * 365; /* 成体は寿命の最長まで */
      if (s.days > 180) err.push(`stages.${s.id}: 1手 ${s.days}日は長すぎる（長くても半年＝180日。orca の下書きは15年だった）`);
      if (span > 0 && s.days > span * 1.2 + 1) err.push(`stages.${s.id}: 1手 ${s.days}日が段の長さ（約${Math.round(span)}日）より長い`);
    });
    if (o0 > o1) err.push('oldAge.years が [最短, 最長] の順でない');
    const ad = st[st.length - 1];
    if (ad.fromAge != null && !(ad.fromAge < o1)) err.push(`stages.${ad.id}: 成体になる年 ${ad.fromAge} が寿命の最長 ${o1} より前でない（成体になれない）`);
    else if (ad.fromAge != null && !(ad.fromAge < o0)) warn.push(`stages.${ad.id}: 成体になる年 ${ad.fromAge} が寿命の最短 ${o0} より前でない（早く死ぬ個体は成体になれない）`);
    if (T && (o1 < T.oldAge[0] || o0 > T.oldAge[1])) err.push(`oldAge ${o0}〜${o1}年が「${T.ja}」の幅 ${T.oldAge[0]}〜${T.oldAge[1]}年から外れる`);
    // 食べ物の無い段（ヒナ・仔・幼生）。卵など hunger 0 の段は要らない
    for (const s of st) if (s.hunger > 0 && !(S.foods || []).some((f) => arr(f.stages).includes(s.id))) err.push(`stages.${s.id}: この段の食べ物が無い（ヒナなら親の運ぶ餌、仔なら母の乳）`);
  }
  if (S.type && !T) err.push(`type「${S.type}」が data/types.json に無い`);
  if (has('places') && (S.places || []).length > 1) {
    // 地図の飛び: 生まれた場所から遠すぎる（octopus: オレゴンとボルネオ）
    const P = S.places, c = P[0], lim = S.locale && S.locale.scale === 'local' ? 1 : 60; /* 海を渡る種は40度ほど離れる（ザトウクジラ）*/
    const dist = (p) => Math.hypot(p.lat - c.lat, ((((p.lon - c.lon) % 360) + 540) % 360) - 180);
    for (const p of P) if (typeof p.lat === 'number' && dist(p) > lim) err.push(`places.${p.id}: 生まれた場所から${Math.round(dist(p))}度も離れている（地名の当たり違い？）`);
    const key = (p) => `${p.lat},${p.lon}`, dup = P.filter((p, i) => P.findIndex((q) => key(q) === key(p)) !== i);
    if (dup.length) warn.push(`places: 同じ座標の場所がある（${dup.map((p) => p.id).join(', ')}）`);
  }
  if (has('foes')) for (const f of S.foes || []) {
    // 死ぬ時は「傷を負った」が「命を落とした」に置き換わる → 「羽に傷を負った」は「羽に命を落とした」になる
    // 人の危険が強すぎ・どこにでも出る → 死因の大半が農薬や網になる（ladybird 79%・mantis・humpback の船）
    if (f.kind === 'human' && f.sev >= 3 && arr(f.places).length > (S.places || []).length / 3) warn.push(`foes.${f.id}: 人の危険が sev 3 で${arr(f.places).length}か所に出る（死因の大半になる。sev 1〜2 にするか場所を絞る）`);
    if (f.lose && !/[、てで。]傷を負った。$/.test(f.lose)) err.push(`foes.${f.id}: lose は「…され、傷を負った。」のように「、」か「て」の後に（死ぬ時の文が変になる）`);
  }
  for (const h of S.happen || []) if (/卵を(産|放)|幼体が現れ|生み落と/.test(h.say || '')) warn.push(`happen: 産卵や孵化の出来事は breeding・段の変わり目と重なる「${h.say.slice(0, 20)}」`);
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
