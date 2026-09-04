---
"@breakedge/the-board-mcp-server": patch
---

0.3.1 バグ修正まとめ

- 0.2.0 以降、`_in[]` 系フィルタに複数値を渡すと先頭の値しか適用されていなかった。カンマ区切りの単一値で送るよう修正(board API の仕様上の制約により、値自体にカンマを含む項目は指定できない)。
- enum 比較を数値同値にし、GET が返す `"10.0"` のような decimal 文字列を PATCH body / GET クエリにそのまま渡しても enum 検証が誤って拒否しないようにした。
- `the_board_api_get` の `query.format` に `null` を渡すとエラーになっていた非対称を修正し、`fields` と同様に未指定として扱うようにした。
- 誤設定などで極端に短い(8 文字未満の) `THE_BOARD_API_KEY` / `THE_BOARD_API_TOKEN` を使っている場合、伏字化処理が応答本文中の無関係な部分文字列(例: `"format"`)を巻き込んで壊さないようにした。
