// 下書きの道具の手元試験（AI を呼ばない）。AI の代わりに見本（マイワシ）の欄を、わざと癖のある形（包む・{id: {...}} の並び）で返す。
//   node tools/selftest.js   → 最後まで通って ✓ なら道具は壊れていない
'use strict';
const fs = require('fs'), path = require('path');
const AI = require('./ai.js');
const S = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sheets', 'sardine.json'), 'utf8'));
let n = 0;
AI.ask = async (prompt) => {
  const keys = [...prompt.match(/出力: (.*) を持つ/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
  const out = {};
  for (const k of keys) out[k] = k === 'locale' ? { ja: '高知県土佐市', geo: 'Tosa Bay', scale: 'regional' } : k === 'places' ? S.places.map(({ lat, lon, stages, ...p }) => ({ ...p, geo: p.ja })) : S[k];
  if (out.places) out.places = Object.fromEntries(out.places.map(({ id, ...p }) => [id, p])); // 癖: 並びを {id: {...}} で返す
  n++;
  return { json: n % 2 ? { sheet: out } : out, by: 'selftest' }; // 癖: 1段包む
};
process.argv[2] = 'tuna'; process.env.SHEET_OUT = require('os').tmpdir() + '/selftest_sheet.json'; try { fs.unlinkSync(process.env.SHEET_OUT); } catch {}
require('./draft.js');
