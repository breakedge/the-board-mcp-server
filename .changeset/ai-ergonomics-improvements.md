---
"@breakedge/the-board-mcp-server": minor
---

AI エージェントからの使用性を改善

- `the_board_api_describe(path, method)` ツールを追加。エンドポイントのクエリパラメータ(enum 込み)と requestBody フィールド(型・必須・enum・ネスト構造)を返し、外部 OpenAPI を見ずに書き込みボディを組めるようにした。
- 同梱スキーマを requestBody/enum 込みで再生成(board API v1.8.0 ベース)。
- `the_board_api_list_paths` が各エンドポイントのクエリパラメータ名を返すようにした。
- 未知のクエリパラメータを有効パラメータ一覧付きで拒否し、サイレントな誤フィルタを防止。配列クエリを Rails 形式で正しく直列化。
- API エラー応答に board の実メッセージを併記し、204 応答を明示的な成功マーカーで返すようにした。
- サーバ instructions にドメインモデル(案件中心の書類作成フロー)・フィルタ命名規約・`response_group=all` を追記。
