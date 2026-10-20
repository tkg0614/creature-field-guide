// 素材の表の下書き: ローカルAI（Ollama）が、資料（sources/<id>/）と見本（sheets/sardine.json）を見て、欄を段ごとに埋める。
// 段ごとに tools/check.js で調べ、誤りがあれば誤りを見せて書き直させる（最大 --tries 回）。AI の呼び出しは ask() の1か所だけ。
//   node tools/draft.js <id> [--model gemma2:9b] [--tries 4]
// 環境変数 OLLAMA_HOST（既定 http://127.0.0.1:11434）
'use strict';
const fs = require('fs'), path = require('path');
const { validate } = require('./check.js');
const { layout } = require('./geo.js');
const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2), opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const id = argv[0], MODEL = opt('model', process.env.MODEL || 'gemma2:9b'), TRIES = +opt('tries', 4);
const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const Q = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'queue.json'), 'utf8')).find((x) => x.id === id);
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'sheets', 'sardine.json'), 'utf8'));
const dir = path.join(ROOT, 'sources', id);
const SRC = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') : '';
const OUT = path.join(ROOT, 'sheets', `${id}.json`);

const AI = require('./ai.js');
const PROVIDER = process.env.PROVIDER || 'cloud';

// 段: 埋める欄・見本の欄・頼み方
const PARTS = [
  { part: 'places', keys: ['locale', 'places', 'start'], ask: '舞台の土地 locale（{ja: 実在の地名, geo: 地図で探せる地名, scale: 一か所のまわりで暮らすなら "local"・海や大陸を渡るなら "regional"}）と、すみか places を6〜8か所書く。すみかは、その土地でこの種が実際に暮らす環境（例: 田んぼ・石垣・林のへり）で、損と得がはっきり違うように danger（0〜3・天敵の多さ）・cover（隠れる所があるか）・about（1〜2文）を付ける。scale が "regional" の時だけ、各すみかに geo（地図で探せる地名）を付ける。緯度経度・edges・region は書かない（地図はコードが作る）。places の最初が生まれる場所。start は {place, month, day}。', sample: (s) => ({ locale: { ja: '土佐湾から道東の沖', geo: 'Tosa Bay', scale: 'regional' }, places: s.places.map(({ lat, lon, stages, ...p }) => p), start: s.start }) },
  { part: 'life', keys: ['size', 'stats', 'stages', 'oldAge', 'breeding', 'foods', 'special', 'levelEvery'], ask: '育ちの段 stages（3〜5個。最後に "adult": true）、寿命 oldAge（野生の値）、繁殖 breeding（実際の季節・場所・数）、食べ物 foods、能力の呼び名 stats（キーは必ず run・sense・forage の3つ。それぞれ {ja, use}）、大きさ size を書く。場所の id は上の places から選ぶ。' },
  { part: 'foes', keys: ['foes'], ask: '天敵 foes を8〜14体書く。その地域・その段で実際にこの種を食べる生き物だけ。宿敵（again と bye を持つ）を2〜3体。人の危険は kind "human" で lose（「傷を負った。」で終える文）を付ける。' },
  { part: 'choices', keys: ['choices', 'happen'], ask: '生き方の分かれ道 choices を3〜4個（実際の生態にある選択だけ。どの選択肢にも損と得。fx は −1〜1）と、季節の出来事 happen を書く。' },
  { part: 'texts', keys: ['lead', 'texts', 'intro', 'wins', 'memories', 'noKids', 'facts'], ask: '見出しの1文 lead、決まった言い回し texts、生まれた時の文 intro、子を残して終わった時 wins、思い出 memories、資料から抜き出した事実 facts（quote は資料の文をそのまま写す）を書く。' },
];

function prompt(P, sheet, errors) {
  const sample = P.sample ? P.sample(SAMPLE) : Object.fromEntries(P.keys.filter((k) => k in SAMPLE).map((k) => [k, SAMPLE[k]]));
  return `あなたは生き物図鑑の編集者です。次の生き物の「一生の素材の表」の一部を JSON で書いてください。

## 生き物
${JSON.stringify({ id: Q.id, ja: Q.ja, sci: Q.sci, 寿命: Q.lifespan, 成熟: Q.maturity, 方針: Q.hint })}

## 決まり
- 実際に起きていることだけ。分からないことは書かない。数字は資料と上の寿命・成熟に合わせる
- 日本語の文は「だ・である」調。短く、情景が見える文。感嘆符で終えない。自分のことは主語を書かない
- ${P.ask}

## これまでに決まった欄（id はここから選ぶ）
${JSON.stringify(Object.fromEntries(Object.entries(sheet).filter(([k]) => ['places', 'stages', 'region'].includes(k)).map(([k, v]) => [k, k === 'region' ? v : v.map((x) => ({ id: x.id, ja: x.ja }))])))}

## 見本（別の生き物・マイワシの同じ欄。形だけまねる。中身はまねない）
${JSON.stringify(sample)}

## 資料（抜粋）
${SRC.slice(0, 7000)}
${errors.length ? `\n## 前の下書きの誤り（直すこと）\n- ${errors.join('\n- ')}` : ''}

出力: ${P.keys.map((k) => `"${k}"`).join('・')} を持つ JSON オブジェクトだけ。`;
}

(async () => {
  if (!Q) { console.error('data/queue.json に無い:', id); process.exit(1); }
  const sheet = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { id: Q.id, ja: Q.ja.replace(/（.*?）/g, ''), sci: Q.sci, status: 'draft', ...(Q.country ? { country: Q.country } : {}) };
  for (const P of PARTS) {
    if (P.keys.every((k) => k in sheet) && !validate(sheet, SRC, [P.part]).errors.length) { console.log(`  ${P.part}: 済`); continue; }
    // この段を書き直すなら、後ろの段は前提が変わるので消す
    for (const Q2 of PARTS.slice(PARTS.indexOf(P) + 1)) for (const k of Q2.keys) delete sheet[k];
    let errors = [], ok = false;
    for (let t = 1; t <= TRIES && !ok; t++) {
      const t0 = Date.now();
      let got; try { const a = await AI.ask(prompt(P, sheet, errors)); got = a.json; (sheet.by = sheet.by || {})[P.part] = a.by; } catch (e) { if (e.allLimited) { console.log('  使える AI が無い。続きは次の回に'); fs.writeFileSync(OUT, JSON.stringify(sheet, null, 1) + '\n'); process.exit(3); } errors = [`JSON として読めない: ${e.message.slice(0, 80)}`]; console.log(`  ${P.part} ${t}回目: ✗ ${errors[0]}`); continue; }
      const trial = JSON.parse(JSON.stringify(sheet)); // 深いコピー（失敗した回の書き換えを残さない） for (const k of P.keys) if (k in got) trial[k] = got[k];
      if (P.part === 'places') for (const p of trial.places || []) p.stages = (trial.stages || []).map((s) => s.id); // すみかの段はコードが決める（AI の書いたものは捨てる）
      if (P.part === 'places') { try { if (!Array.isArray(trial.places) || !trial.locale) throw new Error('locale と places が要る'); await layout(trial, trial.locale); } catch (e) { errors = [e.message]; console.log(`  places ${t}回目: ✗ ${e.message}`); continue; } }
      // 段を決めたら、すみかの stages を補う（空なら全部の段）
      if (P.part === 'life' && Array.isArray(trial.stages)) for (const p of trial.places || []) p.stages = trial.stages.map((s) => s.id); // すみかは全部の段で使える（細かい制限は後で人が足す）
      errors = validate(trial, SRC, P.part === 'places' ? ['places'] : ['places', 'life', P.part]).errors;
      console.log(`  ${P.part} ${t}回目: ${errors.length ? `✗ ${errors.length}件（${errors.slice(0, 2).join(' / ')}）` : '✓'}（${Math.round((Date.now() - t0) / 1000)}秒）`);
      if (!errors.length || t === TRIES) { Object.assign(sheet, trial); ok = !errors.length; }
    }
    fs.writeFileSync(OUT, JSON.stringify(sheet, null, 1) + '\n');
    if (!ok) { sheet.status = 'draft-ng'; fs.writeFileSync(OUT, JSON.stringify(sheet, null, 1) + '\n'); console.log(`✗ ${id}: ${P.part} が直らなかった（下書きは残した）`); process.exit(1); }
  }
  const r = validate(sheet, SRC); sheet.status = r.errors.length ? 'draft-ng' : 'checked';
  fs.writeFileSync(OUT, JSON.stringify(sheet, null, 1) + '\n');
  console.log(`${r.errors.length ? '✗' : '✓'} ${id}: ${sheet.status}${r.warnings.length ? `（△ ${r.warnings.length}件）` : ''}`);
})();
