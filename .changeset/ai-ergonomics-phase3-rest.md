---
"@breakedge/the-board-mcp-server": minor
---

AI エージェント向けの使用性をさらに改善

- エラーメッセージに失敗したリクエスト(method + path)を併記し、AI がどの id/種別が誤りかを自己修正しやすくした。
- 明細(details)を含む文書の書き込みで total が未指定/0 の場合に警告を返す(board は合計を自動集計しないため)。
- リスト取得時にページネーション情報(総件数・ページ・per_page)を提示し、全件取得できているか判断できるようにした。
- `the_board_auth_status` に `validate` オプションを追加し、資格情報が実際に有効かを軽量 API 呼び出しで確認できるようにした。
- 案件作成から自動生成書類の記入までを案内する MCP prompt(`create_project_with_documents`)を追加。
- `the_board_api_list_paths` が toolset で絞り込み中であることを注記するようにした。
