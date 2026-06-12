# Changelog

## 0.2.0

### Minor Changes

- bed5fd3: AI エージェントからの使用性を改善

  - `the_board_api_describe(path, method)` ツールを追加。エンドポイントのクエリパラメータ(enum 込み)と requestBody フィールド(型・必須・enum・ネスト構造)を返し、外部 OpenAPI を見ずに書き込みボディを組めるようにした。
  - 同梱スキーマを requestBody/enum 込みで再生成(board API v1.8.0 ベース)。
  - `the_board_api_list_paths` が各エンドポイントのクエリパラメータ名を返すようにした。
  - 未知のクエリパラメータを有効パラメータ一覧付きで拒否し、サイレントな誤フィルタを防止。配列クエリを Rails 形式で正しく直列化。
  - API エラー応答に board の実メッセージを併記し、204 応答を明示的な成功マーカーで返すようにした。
  - サーバ instructions にドメインモデル(案件中心の書類作成フロー)・フィルタ命名規約・`response_group=all` を追記。

- 850c643: AI エージェント向けの使用性をさらに改善

  - エラーメッセージに失敗したリクエスト(method + path)を併記し、AI がどの id/種別が誤りかを自己修正しやすくした。
  - 明細(details)を含む文書の書き込みで total が未指定/0 の場合に警告を返す(board は合計を自動集計しないため)。
  - リスト取得時にページネーション情報(総件数・ページ・per_page)を提示し、全件取得できているか判断できるようにした。
  - `the_board_auth_status` に `validate` オプションを追加し、資格情報が実際に有効かを軽量 API 呼び出しで確認できるようにした。
  - 案件作成から自動生成書類の記入までを案内する MCP prompt(`create_project_with_documents`)を追加。
  - `the_board_api_list_paths` が toolset で絞り込み中であることを注記するようにした。

## 0.1.4

### Patch Changes

- b5033ee: 製品名を正式表記の board(小文字)に統一。ドキュメント・ツール説明文/title・サーバ instructions・エラーメッセージ中の表記を修正(識別子・URL・環境変数・パッケージ名は変更なし)。

## 0.1.3

### Patch Changes

- 9f1780f: zod を 4.x に対応 (z.record の引数仕様変更に追従)

## 0.1.2

### Fixed

- 一部の npm (10.x) の `npx` で bin スクリプト (`dist/index.js`) の実行権限が失われ `Permission denied` となる問題に対し、`postinstall` で実行権限 (755) を再付与

## 0.1.1

### Fixed

- `bin` スクリプト (`dist/index.js`) に実行権限が付与されず `npx` 実行時に `Permission denied` となる問題を修正 (build 時に `chmod +x`)
- `package.json` の `bin` パスを `./dist/index.js` → `dist/index.js` に正規化 (npm publish 時の警告を解消)
- `repository.url` を `git+https://...` 形式に正規化

## 0.1.0

Initial Beta release.

### Added

- board API (v1.6.0, 89 エンドポイント) を MCP で公開する Generic REST ツール群
  (`the_board_api_get` / `post` / `patch` / `delete` / `list_paths` / `the_board_auth_status`)
- OpenAPI スキーマ駆動のパス検証・サニタイズ (トラバーサル / CRLF 拒否、`/v1/` 強制)
- 3 段階の書き込み安全機構 (`--read-only` デフォルト → `--enable-writes` → `--enable-destructive-writes`、明示 `--read-only` は fail-closed)
- レートリミット (3 req/sec、3,000 req/day、list 系同時 4)
- エラーレスポンスからの認証情報除去、`auth_status` は真偽値のみ返却
- npm (npx) / Docker 配布、CI、Trusted Publishing (OIDC) + provenance
- ドキュメント (README 日英、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT)
