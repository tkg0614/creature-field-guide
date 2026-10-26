// 資料を取ってくる: Wikipedia（日本語・英語）の本文を sources/<id>/ に保存する（CC BY-SA 4.0。出典は各ファイルの1行目）。
//   node tools/fetch.js <id...>   （id は data/queue.json）
'use strict';
const fs = require('fs'), path = require('path');
const Q = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'queue.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 続けて問い合わせると 429（多すぎ）で断られる（2026-10-26: 50種を一度に取って半分以上が「見つからない」になった）→ 間を空け、429 なら待ってやり直す
async function page(lang, title, tries = 3) {
  await sleep(1500);
  const u = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`;
  const r = await fetch(u, { headers: { 'user-agent': 'creature-field-guide/0.1 (github.com/tkg0614/creature-field-guide)' } });
  if (r.status === 429 && tries > 1) { await sleep(15000); return page(lang, title, tries - 1); }
  const j = await r.json(), p = Object.values(j.query.pages)[0];
  return p.extract ? { title: p.title, text: p.extract, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}` } : null;
}
(async () => {
  for (const id of process.argv.slice(2)) {
    const s = Q.find((x) => x.id === id); if (!s) { console.log('queue に無い:', id); continue; }
    const dir = path.join(__dirname, '..', 'sources', id); fs.mkdirSync(dir, { recursive: true });
    const ja = s.ja.replace(/（.*?）/g, ''), sci = s.sci.replace(/[（(].*$/, '').trim();
    for (const [lang, t] of [['ja', ja], ['en', sci]]) {
      const p = await page(lang, t).catch(() => null);
      if (!p) { console.log(`  ${id} ${lang}: 見つからない（${t}）`); continue; }
      fs.writeFileSync(path.join(dir, `wiki_${lang}.txt`), `出典: ${p.url}（CC BY-SA 4.0）\n${p.text}\n`);
      console.log(`  ${id} ${lang}: ${p.title} ${p.text.length}字`);
    }
  }
})();
