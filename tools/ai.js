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
async function resolve(p, force) {
  if (chosen[p.name] && !force) return chosen[p.name];
  const ids = (await listModels(p).catch(() => [])).filter((id) => !/preview|exp|tts|image|vision|embed|audio|live|guard|whisper/i.test(id));
  for (const re of p.prefer) { const hit = ids.filter((id) => new RegExp(re, 'i').test(id)).sort().reverse()[0]; if (hit) { chosen[p.name] = hit; fs.writeFileSync(MODELS, JSON.stringify(chosen, null, 1) + '\n'); return hit; } }
  return null;
}
const usable = () => LIST.filter((p) => process.env[p.key] && !(cool[p.name] && Date.parse(cool[p.name].until) > Date.now()));

async function call(p, prompt) {
  const key = process.env[p.key], model = await resolve(p);
  if (!model) return { status: 404, raw: { error: '使えるモデルが一覧に無い' } };
  if (p.kind === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, responseMimeType: 'application/json' } }) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, retry: r.headers.get('retry-after'), text: j.candidates && j.candidates[0].content && j.candidates[0].content.parts[0].text, raw: j };
  }
  const gh = /models\.github\.ai/.test(p.url) ? { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } : {};
  const r = await fetch(p.url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...gh },
    body: JSON.stringify({ model, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }) });
  const body = await r.text(); let j = {}; try { j = JSON.parse(body); } catch { j = { body: body.slice(0, 200) }; }
  return { status: r.status, retry: r.headers.get('retry-after'), text: j.choices && j.choices[0].message.content, raw: j };
}
// 上限の印: 429、または本文に quota / rate limit / RESOURCE_EXHAUSTED
const limited = (res) => res.status === 429 || /quota|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i.test(JSON.stringify(res.raw || '').slice(0, 2000));

async function ask(prompt) {
  if (process.env.PROVIDER === 'ollama') {
    const r = await fetch(`${process.env.OLLAMA_HOST || 'http://127.0.0.1:11434'}/api/chat`, { method: 'POST', body: JSON.stringify({ model: process.env.MODEL || 'gemma2:9b', stream: false, format: 'json', options: { temperature: 0.5, num_ctx: 8192 }, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json(); if (!j.message) throw new Error(JSON.stringify(j).slice(0, 200));
    return { json: JSON.parse(j.message.content), by: `ollama ${process.env.MODEL || 'gemma2:9b'}` };
  }
  for (;;) {
    const p = usable()[0];
    if (!p) {
      // 休み明けが近い（5分以内）なら待つ。遠ければ、この回はおしまい
      const soon = LIST.filter((q) => process.env[q.key] && cool[q.name]).map((q) => Date.parse(cool[q.name].until) - Date.now()).sort((a, b) => a - b)[0];
      if (soon != null && soon < 300e3) { console.log(`  全部が休み中。${Math.ceil(soon / 1000)}秒待つ`); await new Promise((r) => setTimeout(r, Math.max(1000, soon + 500))); continue; }
      const e = new Error('使える AI が無い（全部が上限で休み中か、鍵が無い）'); e.allLimited = true; throw e;
    }
    let res; try { res = await call(p, prompt); } catch (e) { res = { status: 0, raw: { error: e.message } }; }
    if (limited(res)) {
      const sec = +res.retry > 0 ? +res.retry : /day|daily|per.?day|RPD/i.test(JSON.stringify(res.raw)) ? 86400 : 3600;
      cool[p.name] = { until: new Date(Date.now() + sec * 1000).toISOString(), why: String(JSON.stringify(res.raw)).slice(0, 160) };
      save(); console.log(`  [${p.name}] 上限 → ${Math.round(sec / 60)}分休ませて次の AI へ`); continue;
    }
    // 返事が壊れている（JSON でない・中身が無い）AI は、6時間休ませて次へ（2026-10-20: GitHub Models が何を送っても「OK」だけ返した）
    if (res.status === 404 && !p.retried) { p.retried = 1; delete chosen[p.name]; await resolve(p, true); continue; } // モデルが消えた → 選び直す
    if (!res.text || (res.status && res.status >= 400)) { const h = res.status >= 500 ? 0.15 : 6; /* 5xx（混んでいる）は10分ほど・それ以外は6時間 */ cool[p.name] = { until: new Date(Date.now() + h * 3600e3).toISOString(), why: `壊れた返事 ${res.status} ${JSON.stringify(res.raw).slice(0, 120)}` }; save(); console.log(`  [${p.name}] 返事が壊れている → 6時間休ませて次の AI へ`); continue; }
    return { json: JSON.parse(res.text.replace(/^```(json)?|```$/g, '').trim()), by: `${p.name} ${chosen[p.name]}` };
  }
}
module.exports = { ask, usable };
if (require.main === module) (async () => {
  console.log('使える AI:', usable().map((p) => p.name).join(', ') || 'なし');
  if (process.argv.includes('--ping')) for (const p of usable()) { const r = await call(p, '{"ok": true} とだけ JSON で答えて').catch((e) => ({ status: 0, raw: { error: e.message } })); console.log(`  ${p.name}（${chosen[p.name] || '?'}）: ${r.status} ${r.text ? r.text.slice(0, 60) : JSON.stringify(r.raw).slice(0, 200)}`); }
})();
