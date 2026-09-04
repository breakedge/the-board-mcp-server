# the board MCP Server

[![CI](https://github.com/breakedge/the-board-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/breakedge/the-board-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@breakedge/the-board-mcp-server.svg)](https://www.npmjs.com/package/@breakedge/the-board-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[board](https://the-board.jp/) の非公式 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) サーバです。board はヴェルク株式会社が提供するクラウド型の見積書・請求書管理 SaaS です。

> **免責事項**: このプロジェクトはヴェルク株式会社とは提携関係になく、同社の承認を受けたものではありません。board® はヴェルク株式会社の商標です。

> **データの安全性**: このサーバは請求書・見積書・発注書などの財務データにアクセス・変更できます。十分にご注意ください。デフォルトでは読み取り専用モードが有効です。

## 特徴

- board API v1.9.0 の全 89 エンドポイントに 8 つの汎用 MCP ツールでアクセス
- OpenAPI スキーマ駆動のパス検証
- 3 段階の書き込み安全機構（`--read-only` デフォルト → `--enable-writes` → `--enable-destructive-writes`）
- 組み込みレートリミット（3 req/sec、3,000 req/day）

## インストール

```bash
npx @breakedge/the-board-mcp-server
```

### MCP クライアント設定

MCP クライアントの設定ファイルに追加してください（例: Claude Desktop の `claude_desktop_config.json`）:

```json
{
  "mcpServers": {
    "the-board": {
      "command": "npx",
      "args": ["-y", "@breakedge/the-board-mcp-server"],
      "env": {
        "THE_BOARD_API_KEY": "your-api-key",
        "THE_BOARD_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Docker

```bash
# イメージのビルド
docker build -t breakedge/the-board-mcp-server .

# 実行（stdio）。通常は MCP クライアントがこのコマンドを起動します。
docker run -i --rm \
  -e THE_BOARD_API_KEY="your-api-key" \
  -e THE_BOARD_API_TOKEN="your-api-token" \
  breakedge/the-board-mcp-server
```

Docker を使う MCP クライアント設定:

```json
{
  "mcpServers": {
    "the-board": {
      "command": "docker",
      "args": ["run", "-i", "--rm",
        "-e", "THE_BOARD_API_KEY",
        "-e", "THE_BOARD_API_TOKEN",
        "breakedge/the-board-mcp-server"],
      "env": {
        "THE_BOARD_API_KEY": "your-api-key",
        "THE_BOARD_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

## 利用可能なツール

| ツール | 説明 |
|--------|------|
| `the_board_api_get` | GET リクエスト — 一覧は `{data, pagination, truncated}`、単体は `{data}` の JSON を返す。`format`（concise 既定 / detailed）と `fields`（返すキーの指定）で応答サイズを制御 |
| `the_board_api_validate_write` | POST / PATCH の body をスキーマで乾式検証（必須・enum・型・variant）。API は呼ばず、読み取り専用モードでも使える |
| `the_board_api_post` | POST リクエスト — リソースの作成 |
| `the_board_api_patch` | PATCH リクエスト — リソースの更新、ステータス変更、ロック/解除 |
| `the_board_api_delete` | DELETE リクエスト — リソースの削除 |
| `the_board_api_list_paths` | エンドポイント検索（1 行 1 endpoint、英語・日本語の別名とフィルタ名で検索可、`detail=true` でパラメータと enum） |
| `the_board_api_describe` | エンドポイント定義（クエリパラメータの enum とラベル、requestBody、請求方式などの variant、`part=response` で応答フィールド） |
| `the_board_auth_status` | 認証状態とレートリミット残量の確認 |

> **注意**: 書き込みツールは対応するフラグを付けた場合のみ登録されます。`the_board_api_post` / `the_board_api_patch` は `--enable-writes`、`the_board_api_delete` は `--enable-destructive-writes` を付けたときに現れます。デフォルトの読み取り専用モードでは GET・`list_paths`・`describe`・`validate_write`・`auth_status` のみが利用可能です。

## 応答形式（0.3.0 以降）

`the_board_api_get` の応答には一覧と単体の 2 つの形があります。

一覧 (`/v1/projects` など):

```json
{"data":[{"id":1,"name":"案件A","total":"500000.0"}],"pagination":{"total_count":302,"page":1,"per_page":10,"returned_count":10,"has_more":true,"next_page":2},"truncated":false}
```

単体 (`/v1/projects/123` など。`pagination` と `truncated` は付きません):

```json
{"data":{"id":123,"name":"案件A","total":"500000.0"}}
```

単体の応答には必要に応じて `unknown_fields` / `notice` / `omitted_keys` が付きます。

- 既定の `format: "concise"` は空白なしの JSON で、値が null のキーを省きます（キーが無い = null）。空配列・0・false・空文字は残ります。`format: "detailed"` は従来どおりの整形 JSON で null を保持します。
- `fields` で返すキーを絞れます（ドット区切り、各レコードに適用）: `"fields": ["id","name","total","tax"]`、`"fields": "estimate.details"`。
- 一覧が上限（既定 20,000 字）を超えるとレコード単位で末尾を落とし、`truncated: true`・`dropped_in_page`・`page_incomplete: true` を返します。`page_incomplete` が付いた応答は `has_more` に従わず、`per_page` を小さくするか `fields` で絞って同じページを再取得してから次ページへ進んでください。
- 単体の応答が上限を超えると、JSON が長いトップレベルのキー（配列・オブジェクト）から順に値を落とし、`omitted_keys`（`{key, chars}` の配列）に列挙します。`id` や `name` などのスカラは残るため、必要な項目は `fields` で指定して取得し直してください。
- `notice` は切り詰めや上限超過が起きたときだけ付く案内文です（省略した件数、`fields` での絞り込みの勧め）。通常の応答には含まれません。
- `the_board_api_post` / `the_board_api_patch` は送信前に body を検証します。同梱スキーマが古く誤検出だと確認できた場合のみ、`skip_validation: true` で検証をスキップできます。
- 一覧の並び順: `/v1/projects` は新しい順(公式)。他のリストは順序保証がないため、特定の順序が必要な場合はクライアント側でソートしてください。

## よくある使い方

| やりたいこと | 呼び出し |
|---|---|
| 2026 年 1〜8 月の月別売上（計上ベース、案件のみ） | `get path=/v1/analyses query={report_ym_gteq:"2026-01", report_ym_lteq:"2026-08", "analysis_data_kbn_in[]":["1"]} fields=["report_date","total","tax"]` |
| 8 月請求の未入金一覧 | `get path=/v1/invoices query={invoice_date_gteq:"2026-08-01", invoice_date_lteq:"2026-08-31", "invoice_status_in[]":["2","5"]} fields=["id","name","client.name","total","tax","payment_limit_date"]` |
| 案件番号 1356 の見積明細 | `get path=/v1/projects query={project_no_eq:1356, response_group:"all"} fields=["id","estimate"]` |
| 案件作成前の body 確認 | `describe /v1/projects POST` → `variant` 付きで再度 describe → `validate_write` |

## 設定

### 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `THE_BOARD_API_KEY` | はい | API キー（アカウントごとに 1 つ） |
| `THE_BOARD_API_TOKEN` | はい | API トークン（エンドポイントごとに権限設定可能） |
| `THE_BOARD_API_BASE_URL` | いいえ | ベース URL のオーバーライド（デフォルト: `https://api.the-board.jp`） |
| `THE_BOARD_READ_ONLY` | いいえ | `false` で読み取り専用モードを解除 |
| `THE_BOARD_ENABLE_WRITES` | いいえ | `true` で POST / PATCH を許可 |
| `THE_BOARD_ENABLE_DESTRUCTIVE_WRITES` | いいえ | `true` で DELETE / ステータス変更 / ロックを許可 |
| `THE_BOARD_TOOLSETS` | いいえ | 有効にするツールセット（カンマ区切り、デフォルト: 全て） |
| `THE_BOARD_MAX_RESPONSE_CHARS` | いいえ | GET 応答の上限文字数（既定 20000）。超過分はレコード単位で切り詰め `truncated: true` を返す |
| `THE_BOARD_REQUEST_TIMEOUT_MS` | いいえ | API 呼び出し 1 回あたりの timeout（既定 30000） |

CLI フラグは対応する環境変数より優先されます。さらに、明示的に `--read-only` を指定した場合は最優先の安全装置として扱われ、`--enable-writes` / `--enable-destructive-writes` や対応する環境変数が設定されていても書き込みは無効化されます（fail-closed）。

### CLI フラグ

| フラグ | デフォルト | 説明 |
|--------|-----------|------|
| `--read-only` | `true` | GET リクエストのみ許可 |
| `--enable-writes` | `false` | POST と PATCH リクエストを許可 |
| `--enable-destructive-writes` | `false` | DELETE と不可逆な操作を許可 |
| `--toolsets` | all | 有効にするツールセットのカンマ区切りリスト |

利用可能なツールセット: `projects`, `documents`, `customers`, `payees`, `expenditures`, `master`, `analytics`。指定すると、列挙したツールセットに属するエンドポイントのみが呼び出し可能になります（`list_paths` の表示も絞られます）。

### 書き込み安全レベル

| レベル | 許可される操作 |
|--------|--------------|
| 読み取り専用（デフォルト） | GET のみ |
| 書き込み有効 | + POST、PATCH |
| 破壊的書き込み有効 | + DELETE、ステータス変更、ロック/解除 |

### 0.2.x からの移行

0.3.0 で `the_board_api_get` の応答がルート配列から envelope（一覧は `{data, pagination, truncated}`、単体は `{data}`）に変わり、既定が concise（null 省略）になりました。従来に近い出力が必要なら `format: "detailed"` を指定してください（envelope は付きます）。同梱スキーマは v2 形式（variants / enumLabels / responseFields）です。

## 開発

```bash
git clone https://github.com/breakedge/the-board-mcp-server.git
cd the-board-mcp-server
npm install
cp .env.example .env  # API 認証情報を設定
npm run dev
```

## コントリビュート

[CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。

## ライセンス

[MIT](LICENSE)

---

[English README](README.en.md)
