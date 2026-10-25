// AI の呼び出し口（ここだけ）。data/providers.json の上から順に使い、上限に当たったら次へ回す。
// 上限に当たった AI は data/cooldown.json に「いつまで休むか」を書き、時間が来たらまた使う（工場が commit して次の回に引き継ぐ）。
// 鍵（環境変数）の無い AI は飛ばす。PROVIDER=ollama ならローカルだけ使う（試し用）。
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), CD = path.join(ROOT, 'data', 'cooldown.json');
const LIST = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'providers.json'), 'utf8'));
const load = () => { try { return JSON.parse(fs.readFileSync(CD, 'utf8')); } catch { return {}; } };
let cool = load();
const save = () => fs.writeFileSync(CD, JSON.stringify(cool, null, 1) + '\n');
// モデル名は書かない: その時に使えるモデルの一覧を取り、prefer の上から当たったもの（同じ順位なら名前の新しい方）を使う
const MODELS = path.join(ROOT, 'data', 'models.json');
let chosen = (() => { try { return JSON.parse(fs.readFileSync(MODELS, 'utf8')); } catch { return {}; } })();
async function listModels(p) {
  const key = process.env[p.key];
  if (p.kind === 'gemini') { const j = await (await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } })).json(); return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, '')); }
  const j = await (await fetch(p.list, { headers: { authorization: `Bearer ${key}` } })).json();
  return (j.data || []).map((m) => m.id).filter((id) => !p.onlyFree || /:free$/.test(id));
}
const nextUtc = (h) => { const d = new Date(); d.setUTCHours(h, 5, 0, 0); if (d <= Date.now()) d.setUTCDate(d.getUTCDate() + 1); return +d; };
async function resolve(p, force) {
  if (chosen[p.name] && !force) return chosen[p.name];
  const bad = chosen._bad || [], ids = (await listModels(p).catch(() => [])).filter((id) => !bad.includes(id) && !/preview|exp|tts|image|vision|embed|audio|live|guard|whisper/i.test(id)); /* _bad: 一覧にあるのに 404 を返したモデル（gemini-2.5-pro）*/
  for (const re of p.prefer) { const hit = ids.filter((id) => new RegExp(re, 'i').test(id)).sort().reverse()[p.pick === 'second' ? 1 : 0]; /* second: 1つ前の版（新しい版が混んでいる時の控え） */ if (hit) { chosen[p.name] = hit; fs.writeFileSync(MODELS, JSON.stringify(chosen, null, 1) + '\n'); return hit; } }
  return null;
}
const usable = (minQ = 0) => LIST.filter((p) => (p.quality || 1) >= minQ && process.env[p.key] && !(cool[p.name] && Date.parse(cool[p.name].until) > Date.now()));

async function call(p, prompt) {
  const key = process.env[p.key], model = await resolve(p);
  if (!model) return { status: 404, raw: { error: '使えるモデルが一覧に無い' } };
  if (p.kind === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: p.plainText ? 32768 : 8192 /* Gemma は考えメモで上限を使い切り、答えが途中で切れる */, ...(p.plainText ? {} : { responseMimeType: 'application/json' }) } }) }); /* plainText: JSON 指定を受け付けないモデル（Gemma） */
    const j = await r.json().catch(() => ({}));
    return { status: r.status, retry: r.headers.get('retry-after'), text: j.candidates && j.candidates[0].content && j.candidates[0].content.parts[0].text, raw: j };
  }
  const gh = /models\.github\.ai/.test(p.url) ? { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } : {};
  const r = await fetch(p.url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...gh },
    body: JSON.stringify({ model, temperature: 0.5, max_tokens: 8192 /* 既定が短い所がある（途中で切れた） */, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }) });
  const body = await r.text(); let j = {}; try { j = JSON.parse(body); } catch { j = { body: body.slice(0, 200) }; }
  return { status: r.status, retry: r.headers.get('retry-after'), text: j.choices && j.choices[0].message.content, raw: j };
}
// 上限の印: 429、または本文に quota / rate limit / RESOURCE_EXHAUSTED
const limited = (res) => res.status === 429 || /quota|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i.test(JSON.stringify(res.raw || '').slice(0, 2000));

// minQ: その段に要る質（事実の多い段は Gemini だけ。足りる AI が休み中なら、質の低い AI で済ませずに次の回へ）
async function ask(prompt, minQ = 0, keys = []) {
  if (process.env.PROVIDER === 'ollama') {
    const r = await fetch(`${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/chat`, { method: 'POST', body: JSON.stringify({ model: process.env.MODEL || 'gemma2:9b', stream: false, format: 'json', options: { temperature: 0.5, num_ctx: 8192 }, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json(); if (!j.message) throw new Error(JSON.stringify(j).slice(0, 200));
    return { json: JSON.parse(j.message.content), by: `ollama ${process.env.MODEL || 'gemma2:9b'}` };
  }
  for (;;) {
    const p = usable(minQ)[0];
    if (!p) {
      // 休み明けが近い（15分以内）なら待つ。遠ければ、この回はおしまい
      const soon = LIST.filter((q) => (q.quality || 1) >= minQ && process.env[q.key] && cool[q.name]).map((q) => Date.parse(cool[q.name].until) - Date.now()).sort((a, b) => a - b)[0];
      if (soon != null && soon < 900e3) { console.log(`  全部が休み中。${Math.ceil(soon / 1000)}秒待つ`); await new Promise((r) => setTimeout(r, Math.max(1000, soon + 500))); continue; }
      const e = new Error('使える AI が無い（全部が上限で休み中か、鍵が無い）'); e.allLimited = true; throw e;
    }
    let res; try { res = await call(p, prompt); } catch (e) { res = { status: 0, raw: { error: e.message } }; }
    if (limited(res)) {
      const daily = /day|daily|per.?day|RPD/i.test(JSON.stringify(res.raw));
      // 1日の枠: Gemini は太平洋時間の0時（日本の16〜17時）に戻る → 24時間ではなく次の 08:00 UTC まで（2026-10-22: 24時間休ませて翌朝の回が Gemini を使えなかった）
      const until = +res.retry > 0 ? Date.now() + +res.retry * 1000 : daily && p.kind === 'gemini' ? nextUtc(8) : Date.now() + (daily ? 86400 : 3600) * 1000;
      const sec = Math.round((until - Date.now()) / 1000);
      cool[p.name] = { until: new Date(until).toISOString(), why: String(JSON.stringify(res.raw)).slice(0, 160) };
      save(); console.log(`  [${p.name}] 上限 → ${Math.round(sec / 60)}分休ませて次の AI へ`); continue;
    }
    // 返事が壊れている（JSON でない・中身が無い）AI は、6時間休ませて次へ（2026-10-20: GitHub Models が何を送っても「OK」だけ返した）
    if (res.status === 404 && !p.retried) { p.retried = 1; chosen._bad = [...new Set([...(chosen._bad || []), chosen[p.name]])]; delete chosen[p.name]; await resolve(p, true); continue; } // モデルが消えた → 選び直す
    if (!res.text || (res.status && res.status >= 400)) { const h = res.status >= 500 || !res.status ? 0.15 : 6; /* 5xx（混んでいる）は10分ほど・それ以外は6時間 */ cool[p.name] = { until: new Date(Date.now() + h * 3600e3).toISOString(), why: `壊れた返事 ${res.status} ${JSON.stringify(res.raw).slice(0, 120)}` }; save(); console.log(`  [${p.name}] ${res.status >= 500 ? '混んでいる → 10分' : '返事が壊れている → 6時間'}休ませて次の AI へ`); continue; }
    try { return { json: pickJson(res.text, keys), by: `${p.name} ${chosen[p.name]}` }; }
    catch (e) { console.log(`  [${p.name}] JSON が読めない: ${JSON.stringify(res.text.slice(0, 160))}`); e.message += `（${p.name}）`; throw e; }
  }
}
// 答えから JSON を取り出す: 括弧の対応で「{ … }」をすべて拾い、読めるものの中から、欲しい欄（keys）を一番多く持つもの（同点なら後ろ）を選ぶ
// 2026-10-22: 前置きの {ja: 地名} 等に惑わされた → 括弧の対応で探す
// 2026-10-25: Gemma が答えの前に考えメモ（見本の欠片 {ja, geo, scale} など）を書き、最初に読めた欠片を答えにしていた → 欲しい欄で選ぶ
function pickJson(t, keys = []) {
  const found = [];
  const fence = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const f of fence) { try { found.push(JSON.parse(f)); } catch { /* 下で探す */ } }
  let last;
  for (let i = t.indexOf('{'); i >= 0; i = t.indexOf('{', i + 1)) {
    let d = 0, q = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') q = false; continue; }
      if (c === '"') q = true; else if (c === '{') d++; else if (c === '}' && --d === 0) { const sl = t.slice(i, j + 1); try { found.push(JSON.parse(sl)); } catch (e) { try { found.push(JSON.parse(sl.replace(/,\s*([}\]])/g, '$1'))); } catch { last = e; } } break; }
    }
  }
  if (!found.length) throw last || new Error('JSON が見つからない（途中で切れている）');
  const score = (o) => (o && typeof o === 'object' ? keys.filter((k) => k in o).length : 0);
  let best = found[0];
  for (const o of found) if (score(o) >= score(best)) best = o;
  if (keys.length && !score(best)) best = found.reduce((a, o) => (JSON.stringify(o).length > JSON.stringify(a).length ? o : a)); // 欲しい欄が無ければ一番大きいもの（包みは draft.js が外す）
  return best;
}
module.exports = { ask, usable, pickJson };
if (require.main === module) (async () => {
  console.log('使える AI:', usable().map((p) => p.name).join(', ') || 'なし');
  if (process.argv.includes('--ping')) for (const p of usable()) { const r = await call(p, '{"ok": true} とだけ JSON で答えて').catch((e) => ({ status: 0, raw: { error: e.message } })); console.log(`  ${p.name}（${chosen[p.name] || '?'}）: ${r.status} ${r.text ? r.text.slice(0, 60) : JSON.stringify(r.raw).slice(0, 200)}`); }
})();
