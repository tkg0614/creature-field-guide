# 検品の手順（Claude 用・トークンを節約する）

表の全文は読まない。読むのは `digest.js` の要約だけ。1回に最大12種。

```
cd /home/user/creature-field-guide
node tools/fix.js $(ls sheets | sed 's/.json//') | grep -v ': 0'       # 機械で直る誤り
IDS=$(node -e 'const fs=require("fs");console.log(fs.readdirSync("sheets").map(f=>JSON.parse(fs.readFileSync("sheets/"+f))).filter(s=>s.status==="checked").map(s=>s.id).slice(0,12).join(" "))')
node tools/digest.js $IDS
# → 直しを /tmp/edits.json に書く（書式は tools/patch.js の先頭）
node tools/patch.js /tmp/edits.json                                    # 緑なら reviewed・review_log.tsv に1行
bash /home/user/claude-brain/dev/ippiki/proto/ingest.sh $PWD $IDS     # 束にしてゲームへ（✗ の束は入らない）
```

## 見るところ（直すのは明らかな誤りだけ。好みで書き換えない）
- ✗ は必ず直す。△ は中身を見て判断
- 段: 1手の日数と fromAge が寿命・成熟と合う。oldAge は型の範囲内
- 餌: 食べない段（卵・蛹）に餌を付けない。ヒナ・仔には親の餌がある
- 天敵: 実在する名前（Gemma は「スキア」「ステラー海鵰」のような無い名前を作る）・本当にその生き物を襲う。人の危険は2〜3体まで・強さ1〜2・場所を絞る
- 場所: 名前と座標が合う（「台湾」「ベーリング海」が日本の真ん中にある等）。同じ座標の重なりはずらす。local は近く、regional は60度以内
- 出来事（happen）: 天敵・繁殖・孵化と重ならない。死なせない
- 特技: 生き物が「する」能力（「寄生される」は特技ではない）
- 繁殖の months は「プレイヤーが子を残す行動をする月」。交尾の月で良い（出産の月へ変えて子が0%になった例: deer）
- ingest の死因: 人が首位でも現実どおりなら良い（シカの猟・車）。✗ のまま直らない種は `"hold": true` で残し、理由を台帳へ

## 終わったら
- 両方のリポジトリを commit・push（creature-field-guide は main、claude-brain は master）
- checked が0になった回だけ: journey.html でアーティファクト更新・結果（直した件数・似た遊び）をユーザーへ
