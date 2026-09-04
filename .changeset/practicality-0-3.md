---
"@breakedge/the-board-mcp-server": minor
---

実用性改善 (0.3.0)。GET 応答の envelope 化と token 制御、導線と検証の強化。

- `the_board_api_get` の応答を envelope の JSON に変更 (破壊的)。一覧は `{data, pagination, truncated}`、単体は `{data}` (必要に応じて `unknown_fields` / `notice` / `omitted_keys` を付与)。既定 `format: concise` は compact JSON で null キーを省略 (空配列・0・false・"" は保持)。`format: detailed` で従来に近い整形 JSON。`fields` で返すキーを指定可能。上限 (`THE_BOARD_MAX_RESPONSE_CHARS`、既定 20,000 字) 超過時は、一覧はレコード単位で切り詰め `truncated: true` と `page_incomplete: true` (同じ page の再取得を案内)、単体は大きなトップレベルキーを省いて `omitted_keys` に列挙。
- `the_board_api_list_paths` の既定出力を 1 行 1 endpoint に変更し、英語・日本語の別名とフィルタ名で検索可能に。`detail=true` で従来の JSON。
- `the_board_api_describe` に `variant` (請求方式などの分岐) と `part=response` (応答フィールド) を追加。enum を値とラベルで構造化し、URL エンコード注記などのノイズを除去。出力は compact JSON。
- `the_board_api_validate_write` を追加 (読み取り専用モードでも使える乾式検証)。post / patch は送信前に required / enum / 型を検証し、不正なら API を呼ばない。検証が誤検出だと確認できた場合のみ `skip_validation: true` でスキップ可能。
- query 値 (型・enum・日付形式・per_page 範囲) を送信前に検証。
- エラー: method 非対応時の案内、未知パスの候補提示、422 配列エラーの整形。0 件応答に適用フィルタを echo。
- API 呼び出しに timeout (`THE_BOARD_REQUEST_TIMEOUT_MS`、既定 30 秒)。429 リトライがレート制限カウンタを通るよう修正。成功応答本文も資格情報を伏字化。
- 同梱スキーマを公式 v1.9.0 から v2 形式 (variants / enumLabels / responseFields) で再生成。週次で公式 spec との差分を検知する CI を追加。
- instructions にユースケース早見表・応答形式・意味論 (新しい順 / 税抜 / 注記行) を追加。
