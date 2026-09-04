# Changelog

## 0.3.1

### Patch Changes

- 23a06fe: 0.3.1 バグ修正まとめ

  - 0.2.0 以降、`_in[]` 系フィルタに複数値を渡すと先頭の値しか適用されていなかった。カンマ区切りの単一値で送るよう修正(board API の仕様上の制約により、値自体にカンマを含む項目は指定できない)。
  - enum 比較を数値同値にし、GET が返す `"10.0"` のような decimal 文字列を PATCH body / GET クエリにそのまま渡しても enum 検証が誤って拒否しないようにした。
  - `the_board_api_get` の `query.format` に `null` を渡すとエラーになっていた非対称を修正し、`fields` と同様に未指定として扱うようにした。
  - 誤設定などで極端に短い(8 文字未満の) `THE_BOARD_API_KEY` / `THE_BOARD_API_TOKEN` を使っている場合、伏字化処理が応答本文中の無関係な部分文字列(例: `"format"`)を巻き込んで壊さないようにした。

## 0.3.0

### Minor Changes

- d3ac235: 実用性改善 (0.3.0)。GET 応答の envelope 化と token 制御、導線と検証の強化。

  - `the_board_api_get` の応答を envelope の JSON に変更 (破壊的)。一覧は `{data, pagination, truncated}`、単体は `{data}` (必要に応じて `unknown_fields` / `notice` / `omitted_keys` を付与)。既定 `format: concise` は compact JSON で null キーを省略 (空配列・0・false・"" は保持)。`format: detailed` で従来に近い整形 JSON。`fields` で返すキーを指定可能。上限 (`THE_BOARD_MAX_RESPONSE_CHARS`、既定 20,000 字) 超過時は、一覧はレコード単位で切り詰め `truncated: true` と `page_incomplete: true` (同じ page の再取得を案内)、単体は大きなトップレベルキーを省いて `omitted_keys` に列挙。
  - `the_board_api_list_paths` の既定出力を 1 行 1 endpoint に変更し、英語・日本語の別名とフィルタ名で検索可能に。`detail=true` で従来の JSON。
  - `the_board_api_describe` に `variant` (請求方式などの分岐) と `part=response` (応答フィールド) を追加。enum を値とラベルで構造化し、URL エンコード注記などのノイズを除去。出力は compact JSON。
  - `the_board_api_validate_write` を追加 (読み取り専用モードでも使える乾式検証)。post / patch は送信前に required / enum / 型を検証し、不正なら API を呼ばない。検証が誤検出だと確認できた場合のみ `skip_validation: true` でスキップ可能。
  - query 値 (型・enum・日付形式・per_page 範囲) を送信前に検証。
  - エラー: method 非対応時の案内、未知パスの候補提示、422 配列エラーの整形。0 件応答に適用フィルタを echo。
  - API 呼び出しに timeout (`THE_BOARD_REQUEST_TIMEOUT_MS`、既定 30 秒)。429 リトライがレート制限カウンタを通るよう修正。成功応答本文も資格情報を伏字化。
  - 同梱スキーマを公式 v1.9.0 から v2 形式 (variants / enumLabels / responseFields) で再生成。週次で公式 spec との差分を検知する CI を追加。
  - instructions にユースケース早見表・応答形式・意味論 (新しい順 / 税抜 / 注記行) を追加。

## 0.2.1

### Patch Changes

- 8bb4a3a: 堅牢化と describe の改善(0.2.0 後のバックログ消化)

  - `the_board_api_describe` の requestBody フィールドに `format`(date / int32 / decimal 等)を出力し、値の形を組み立てやすくした。
  - `the_board_auth_status` の `validate` が有効な `--toolsets` 内のエンドポイントを検証に使うようにし、403(認証成功・権限不足)を資格情報有効として扱うようにした(従来は invalid 判定)。
  - ページネーションヘッダの NaN ガード、クエリ配列要素の allowlist 検証、generic エラーメッセージの資格情報伏字化(defense-in-depth)を追加。
  - スキーマ生成器に anyOf/oneOf union・readOnly 除外などの回帰テストを追加。

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
