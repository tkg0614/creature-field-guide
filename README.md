# creature-field-guide

実在の生き物の「一生の素材」を集める図鑑です。1種につき1枚の表（`sheets/<id>.json`）に、すみか・食べ物・天敵・育ちの段・子を残す季節・生き方の分かれ道を、資料の文つきで書きます。

- 書き方: [SHEET.md](SHEET.md)（見本: `sheets/sardine.json`）
- 下書き: ローカルAI（[Ollama](https://ollama.com)）が資料（`sources/<id>/`、Wikipedia 本文 CC BY-SA 4.0）を読んで書き、`tools/check.js` が機械で検査します（`.github/workflows/draft.yml` が毎晩まわす）
- 状態: `status` が `draft`（下書き）→ `checked`（検査に通った）→ `reviewed`（読み直し済み）

```
node tools/fetch.js <id>     # 資料を取ってくる
node tools/draft.js <id>     # ローカルAIで下書き（Ollama が要る）
node tools/check.js <id>     # 検査
```

`sources/` の文章は Wikipedia からの引用で、CC BY-SA 4.0 に従います（各ファイルの1行目に出典）。
