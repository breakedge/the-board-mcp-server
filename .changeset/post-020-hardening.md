---
"@breakedge/the-board-mcp-server": patch
---

堅牢化と describe の改善(0.2.0 後のバックログ消化)

- `the_board_api_describe` の requestBody フィールドに `format`(date / int32 / decimal 等)を出力し、値の形を組み立てやすくした。
- `the_board_auth_status` の `validate` が有効な `--toolsets` 内のエンドポイントを検証に使うようにし、403(認証成功・権限不足)を資格情報有効として扱うようにした(従来は invalid 判定)。
- ページネーションヘッダの NaN ガード、クエリ配列要素の allowlist 検証、generic エラーメッセージの資格情報伏字化(defense-in-depth)を追加。
- スキーマ生成器に anyOf/oneOf union・readOnly 除外などの回帰テストを追加。
