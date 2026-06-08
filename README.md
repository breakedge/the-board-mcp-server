# the board MCP Server

[![CI](https://github.com/breakedge/the-board-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/breakedge/the-board-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@breakedge/the-board-mcp-server.svg)](https://www.npmjs.com/package/@breakedge/the-board-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[board](https://the-board.jp/) の非公式 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) サーバです。board はヴェルク株式会社が提供するクラウド型の見積書・請求書管理 SaaS です。

> **免責事項**: このプロジェクトはヴェルク株式会社とは提携関係になく、同社の承認を受けたものではありません。board® はヴェルク株式会社の商標です。

> **データの安全性**: このサーバは請求書・見積書・発注書などの財務データにアクセス・変更できます。十分にご注意ください。デフォルトでは読み取り専用モードが有効です。

## 特徴

- board API v1.6.0 の全 89 エンドポイントに 6 つの汎用 MCP ツールでアクセス
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
| `the_board_api_get` | GET リクエスト — リソースの取得（単体またはリスト） |
| `the_board_api_post` | POST リクエスト — リソースの作成 |
| `the_board_api_patch` | PATCH リクエスト — リソースの更新、ステータス変更、ロック/解除 |
| `the_board_api_delete` | DELETE リクエスト — リソースの削除 |
| `the_board_api_list_paths` | 利用可能な API エンドポイントの検索 |
| `the_board_auth_status` | 認証状態とレートリミット残量の確認 |

> **注意**: 書き込みツールは対応するフラグを付けた場合のみ登録されます。`the_board_api_post` / `the_board_api_patch` は `--enable-writes`、`the_board_api_delete` は `--enable-destructive-writes` を付けたときに現れます。デフォルトの読み取り専用モードでは GET・`list_paths`・`auth_status` のみが利用可能です。

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
