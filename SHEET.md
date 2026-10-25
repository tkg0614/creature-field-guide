# 素材の表（sheets/&lt;id&gt;.json）の書き方

1種につき1枚。実在の生き物の **一生の素材**（どこで暮らし、何を食べ、何に狙われ、いつ子を残すか）を、決まった欄に埋めます。
見本は `sheets/sardine.json`（マイワシ）。迷ったら見本と同じ形にします。

## 事実の決まり（いちばん大事）
- 書くのは、その種で実際に起きていることだけ。分からないことは書かない
- 場所の緯度・経度は実際の位置（±0.5度以内）。海の場所は海の上、陸の場所は陸の上
- 天敵は、その地域・その大きさの時期に、実際にその種を食べる生き物（人の網・わな・車は `kind: "human"`）
- 資料（`sources/<id>/`）に書いてあることは、`facts` に抜き出して、資料の文をそのまま `quote` に写す

## 言葉の決まり
- 文は「だ・である」調。短く、情景が見える文。感嘆符・疑問符で終えない
- 自分のことは主語を書かない（「〜した。」）

## 欄
| 欄 | 中身 |
|---|---|
| `id` `ja` `sci` `lead` | 名前・学名・見出しの下の1文（どこで生まれ、どう生きるか） |
| `start` | `{place, month, day}` 生まれる場所と月日 |
| `size` | `{ja, unit, start}` 例 `{"ja": "体長", "unit": "cm", "start": 0.3}` |
| `stats` | `{run, sense, forage}` それぞれ `{ja, use}`。逃げる力・気づく力・食べる力の、その種らしい呼び名 |
| `stages` | 育ちの段（3〜5個）`{id, ja, fromAge(年), days(1手の日数), hunger, grow, goal, enter(その段になった時の文)}`。最後の段に `"adult": true` |
| `oldAge` | `{years: [最短, 最長], text}` 野生で老いて死ぬ年齢の幅（飼育下の最大は使わない） |
| `region` | 地域の地図 `{ja, lon0, lon1, lat0, lat1, k, labels: [[lat, lon, 文字]]}`。幅×k が 450〜560 になる k |
| `places` | すみか5〜9か所 `{id, ja, lat, lon, about, danger(0〜3), cover, sea, stages, months}`。損と得がはっきり違うように |
| `edges` | 行き来できる組 `[[a, b], ...]`（全部つながること） |
| `foods` | 食べ物 `{id, ja(札の名前), name(餌の名前), ds, stages, places, rich(多い場所), ok(食べた文)}` |
| `special` | その種ならではの行動（任意）`{id, ja, ds, stages, stat, calm/watch, ok}` |
| `breeding` | 子を残す `{ja, ds, months, places, perYear, kids: [最小, 最大], many, label: {ja, unit, child}, ok, ng, goal1, goal2}`。数は実際にありうる数 |
| `choices` | 生き方の分かれ道（3つ以上）`{q, stages, month, opts: [{ja, ds, fx: {danger, food, kids}, goto, say, chip}]}`。fx は −1〜+1。どの選択肢にも損と得 |
| `apex` | 自然の天敵がほとんどいない頂点捕食者なら `true`（天敵は4体から・宿敵1体から。人の危険を主に書く） |
| `foes` | 天敵8〜14体 `{id, ja, kind, places, stages, sev(1〜3), fast, texts(2〜3通り), again(宿敵だけ), bye, lose(網・車など)}` |
| `migrate` | 季節の回遊（任意・海や大陸を渡る種）`[{months, stages, to, say}]`。その月になったら `to` の場所へ自動で移る。子を産む場所へ毎年戻る種（クジラなど）は必ず書く |
| `happen` | 季節の出来事（任意）`{month, stages, places, p, say, full, hurt}` |
| `texts` | `move`（`{to}`へ…）・`fleeJa`・`restJa`・`watchJa`・`lieJa`・`lastMemory` |
| `intro` `wins` `memories` `noKids` | 生まれた時の文・子を残して終わった時・死ぬ時に思い出すこと・子を残さずに終わった時 |
| `facts` | `[{claim, quote, source}]` 資料から抜き出した事実 |
| `status` | `draft`（機械の下書き）→ `checked`（検査に通った）→ `reviewed`（人かClaudeが読んだ） |
