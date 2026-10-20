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
const usable = () => LIST.filter((p) => process.env[p.key] && !(cool[p.name] && Date.parse(cool[p.name].until) > Date.now()));

async function call(p, prompt) {
  const key = process.env[p.key];
  if (p.kind === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, responseMimeType: 'application/json' } }) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, retry: r.headers.get('retry-after'), text: j.candidates && j.candidates[0].content && j.candidates[0].content.parts[0].text, raw: j };
  }
  const gh = /models\.github\.ai/.test(p.url) ? { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' } : {};
  const r = await fetch(p.url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...gh },
    body: JSON.stringify({ model: p.model, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }) });
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
    if (!p) { const e = new Error('使える AI が無い（全部が上限で休み中か、鍵が無い）'); e.allLimited = true; throw e; }
    let res; try { res = await call(p, prompt); } catch (e) { res = { status: 0, raw: { error: e.message } }; }
    if (limited(res)) {
      const sec = +res.retry > 0 ? +res.retry : /day|daily|per.?day|RPD/i.test(JSON.stringify(res.raw)) ? 86400 : 3600;
      cool[p.name] = { until: new Date(Date.now() + sec * 1000).toISOString(), why: String(JSON.stringify(res.raw)).slice(0, 160) };
      save(); console.log(`  [${p.name}] 上限 → ${Math.round(sec / 60)}分休ませて次の AI へ`); continue;
    }
    if (!res.text) throw new Error(`[${p.name}] ${res.status} ${JSON.stringify(res.raw).slice(0, 200)}`);
    return { json: JSON.parse(res.text.replace(/^```(json)?|```$/g, '').trim()), by: p.name };
  }
}
module.exports = { ask, usable };
if (require.main === module) (async () => {
  console.log('使える AI:', usable().map((p) => p.name).join(', ') || 'なし');
  if (process.argv.includes('--ping')) for (const p of usable()) { const r = await call(p, '{"ok": true} とだけ JSON で答えて').catch((e) => ({ status: 0, raw: { error: e.message } })); console.log(`  ${p.name}: ${r.status} ${r.text ? r.text.slice(0, 60) : JSON.stringify(r.raw).slice(0, 200)}`); }
})();
