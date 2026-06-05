# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0]

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
