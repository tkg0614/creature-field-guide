// 検品用の短い要約（Claude が読むのはこれだけ。表の全文は読まない）。node tools/digest.js <id...>
// 行頭の [foes.3] などは patch.js で直す時の道（path）。
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), { validate } = require('./check.js');
const Q = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'queue.json'), 'utf8')).map((q) => [q.id, q]));
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'types.json'), 'utf8'));
const a = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]), c = (s, n = 40) => String(s ?? '').replace(/\s+/g, '').slice(0, n);
for (const id of process.argv.slice(2)) {
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'sheets', `${id}.json`), 'utf8')), q = Q[id] || {};
  const dir = path.join(ROOT, 'sources', id), src = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') : '';
  const r = validate(S, src), o = [];
  const tp = T.find((t) => t.id === S.type) || {};
  o.push(`■ ${id} ${S.ja}（${S.sci}）${S.type} ${S.locale?.ja || ''}/${S.locale?.scale || ''} 状態=${S.status}`);
  o.push(`  寿命=${q.lifespan?.typical ?? '?'}(最大${q.lifespan?.max ?? '?'})年 成熟=${q.maturity?.value ?? '?'}年 oldAge=${a(S.oldAge?.years).join('〜')}年 型の範囲=${a(tp.oldAge).join('〜')}`);
  r.errors.forEach((e) => o.push(`  ✗ ${e}`));
  r.warnings.filter((w) => !/資料に無い引用/.test(w)).forEach((w) => o.push(`  △ ${w}`));
  o.push('  場所: ' + (S.places || []).map((p, i) => `[${i}]${p.ja}(危${p.danger}${p.cover ? '隠' : ''} ${a(p.stages).join('/')} ${(+p.lat).toFixed(2)},${(+p.lon).toFixed(2)})`).join(' '));
  o.push(`  開始=${S.start?.place} ${S.start?.month}/${S.start?.day}`);
  o.push('  段: ' + (S.stages || []).map((s, i) => `[${i}]${s.ja}(${s.fromAge ?? 0}年〜 1手${s.days}日 空腹${s.hunger})`).join(' '));
  const b = S.breeding || {};
  o.push(`  繁殖: ${b.ja} ${a(b.months).join(',')}月 年${b.perYear} 子${a(b.kids).join('〜')} 場所=${a(b.places).join('/')}`);
  o.push('  餌: ' + (S.foods || []).map((f, i) => `[${i}]${f.name}(${a(f.stages).join('/')})`).join(' '));
  o.push('  天敵: ' + (S.foes || []).map((f, i) => `[${i}]${f.ja}(${f.kind} 強${f.sev}${f.nemesis ? ' 宿敵' : ''} ${a(f.stages).join('/')} ${a(f.places).length}か所)`).join(' '));
  if ((S.special || []).length) o.push('  特技: ' + S.special.map((f, i) => `[${i}]${f.ja}(${a(f.stages).join('/')})`).join(' '));
  if ((S.migrate || []).length) o.push('  移動: ' + S.migrate.map((m, i) => `[${i}]${a(m.months).join(',')}月→${m.to}`).join(' '));
  o.push('  出来事: ' + (S.happen || []).map((h, i) => `[${i}]${a(h.month).join(',')}月 ${c(h.say, 30)}`).join(' '));
  o.push('  選択: ' + (S.choices || []).map((h, i) => `[${i}]${a(h.month).join(',')}月 ${a(h.stages).join('/')} ${c(h.q, 30)}`).join(' '));
  o.push(`  導入: ${c(S.lead, 60)} ／ ${c(a(S.intro)[0], 40)} ／ 老い: ${c(S.oldAge?.text, 40)}`);
  console.log(o.join('\n'));
}
