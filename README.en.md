# the board MCP Server

[![CI](https://github.com/breakedge/the-board-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/breakedge/the-board-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@breakedge/the-board-mcp-server.svg)](https://www.npmjs.com/package/@breakedge/the-board-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An unofficial [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [board](https://the-board.jp/) — a cloud-based invoicing and project management SaaS by VELC Inc.

> **Disclaimer**: This project is not affiliated with or endorsed by VELC Inc. board® is a trademark of VELC Inc.

> **Data Safety**: This server can access and modify financial data (invoices, estimates, purchase orders). Use with caution. Read-only mode is enabled by default.

## Features

- Access all 89 endpoints of the board API v1.9.0 via 8 generic MCP tools
- OpenAPI schema-driven path validation
- 3-tier write safety (`--read-only` default → `--enable-writes` → `--enable-destructive-writes`)
- Built-in rate limiting (3 req/sec, 3,000 req/day)

## Installation

```bash
npx @breakedge/the-board-mcp-server
```

### MCP Client Configuration

Add to your MCP client config (e.g., Claude Desktop `claude_desktop_config.json`):

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
# Build the image
docker build -t breakedge/the-board-mcp-server .

# Run (stdio). The MCP client typically launches this command.
docker run -i --rm \
  -e THE_BOARD_API_KEY="your-api-key" \
  -e THE_BOARD_API_TOKEN="your-api-token" \
  breakedge/the-board-mcp-server
```

MCP client configuration with Docker:

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

## Available Tools

| Tool | Description |
|------|-------------|
| `the_board_api_get` | GET request — returns JSON `{data, pagination, truncated}` for lists and `{data}` for a single record. Controls response size via `format` (concise default / detailed) and `fields` (select returned keys) |
| `the_board_api_validate_write` | Dry-run validation of a POST / PATCH body against the schema (required / enum / type / variant). Does not call the API and works in read-only mode |
| `the_board_api_post` | POST request — create resources |
| `the_board_api_patch` | PATCH request — update resources, change status, lock/unlock |
| `the_board_api_delete` | DELETE request — delete resources |
| `the_board_api_list_paths` | Search endpoints (one line per endpoint, searchable by English/Japanese aliases and filter names, `detail=true` for parameters and enums) |
| `the_board_api_describe` | Endpoint definition (query parameter enums and labels, requestBody, variants such as billing modes, `part=response` for response fields) |
| `the_board_auth_status` | Check authentication status and rate limit remaining |

> **Note**: Write tools are registered only when the matching flag is set. `the_board_api_post` / `the_board_api_patch` appear with `--enable-writes`, and `the_board_api_delete` with `--enable-destructive-writes`. In the default read-only mode, only the GET, `list_paths`, `describe`, `validate_write`, and `auth_status` tools are available.

## Response Format (0.3.0+)

`the_board_api_get` has two response shapes: list and single.

List (e.g. `/v1/projects`):

```json
{"data":[{"id":1,"name":"案件A","total":"500000.0"}],"pagination":{"total_count":302,"page":1,"per_page":10,"returned_count":10,"has_more":true,"next_page":2},"truncated":false}
```

Single (e.g. `/v1/projects/123`; no `pagination` and no `truncated`):

```json
{"data":{"id":123,"name":"案件A","total":"500000.0"}}
```

A single response may also carry `unknown_fields`, `notice` or `omitted_keys`.

- The default `format: "concise"` is compact JSON with null-valued keys omitted (a missing key means null). Empty arrays, `0`, `false`, and empty strings are kept. `format: "detailed"` is the previous pretty-printed JSON with nulls kept.
- `fields` narrows the returned keys (dot paths, applied per record): `"fields": ["id","name","total","tax"]`, `"fields": "estimate.details"`.
- A list over the limit (default 20,000 chars) drops trailing records: `truncated: true`, `dropped_in_page` and `page_incomplete: true`. When `page_incomplete` is present, ignore `has_more`: lower `per_page` or narrow `fields`, re-fetch the same page, and only then move on to the next page.
- A single response over the limit drops the top-level keys (arrays and objects) with the longest JSON and lists them in `omitted_keys` (an array of `{key, chars}`). Scalars such as `id` and `name` are kept, so re-fetch what you need with `fields`.
- `notice` appears only when records were dropped or the response exceeded the limit (how many were omitted, and the suggestion to narrow `fields`). Normal responses do not include it.
- `the_board_api_post` / `the_board_api_patch` validate the body before sending. Pass `skip_validation: true` only when you have confirmed the bundled schema is stale and the validation error is wrong.
- List order: `/v1/projects` lists are returned newest first (official spec); other list endpoints have no documented order. Sort client-side if you need a specific order.
- Array filters such as `_in[]` are sent as a single comma-joined value (a board API limitation), so a value that itself contains a comma (e.g. a tag name) cannot be expressed.

## Common Tasks

| What you want | Call |
|---|---|
| Monthly sales for Jan-Aug 2026 (accrual basis, projects only) | `get path=/v1/analyses query={report_ym_gteq:"2026-01", report_ym_lteq:"2026-08", "analysis_data_kbn_in[]":["1"]} fields=["report_date","total","tax"]` |
| Unpaid invoices billed in August | `get path=/v1/invoices query={invoice_date_gteq:"2026-08-01", invoice_date_lteq:"2026-08-31", "invoice_status_in[]":["2","5"]} fields=["id","name","client.name","total","tax","payment_limit_date"]` |
| Estimate line items for project no. 1356 | `get path=/v1/projects query={project_no_eq:1356, response_group:"all"} fields=["id","estimate"]` |
| Check a body before creating a project | `describe /v1/projects POST` → describe again with `variant` → `validate_write` |

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `THE_BOARD_API_KEY` | Yes | API key (one per account) |
| `THE_BOARD_API_TOKEN` | Yes | API token (configurable per-endpoint permissions) |
| `THE_BOARD_API_BASE_URL` | No | Override base URL (default: `https://api.the-board.jp`) |
| `THE_BOARD_READ_ONLY` | No | Set to `false` to disable read-only mode |
| `THE_BOARD_ENABLE_WRITES` | No | Set to `true` to allow POST / PATCH |
| `THE_BOARD_ENABLE_DESTRUCTIVE_WRITES` | No | Set to `true` to allow DELETE / status changes / lock |
| `THE_BOARD_TOOLSETS` | No | Comma-separated toolsets to enable (default: all) |
| `THE_BOARD_MAX_RESPONSE_CHARS` | No | Max character length of a GET response (default 20000). Excess is dropped at record boundaries, returning `truncated: true` |
| `THE_BOARD_REQUEST_TIMEOUT_MS` | No | Timeout per API call (default 30000) |

CLI flags take precedence over the corresponding environment variables. In addition, an explicit `--read-only` is the strongest safety switch: it disables all write tools even when write flags or their environment variables are set (fail-closed).

### CLI Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--read-only` | `true` | Only allow GET requests |
| `--enable-writes` | `false` | Allow POST and PATCH requests |
| `--enable-destructive-writes` | `false` | Allow DELETE and irreversible operations |
| `--toolsets` | all | Comma-separated list of enabled toolsets |

Available toolsets: `projects`, `documents`, `customers`, `payees`, `expenditures`, `master`, `analytics`. When set, only endpoints belonging to the listed toolsets are callable (and shown by `list_paths`).

### Write Safety Levels

| Level | Allowed Operations |
|-------|--------------------|
| Read-only (default) | GET only |
| Writes enabled | + POST, PATCH |
| Destructive writes | + DELETE, status changes, lock/unlock |

### Migrating from 0.2.x

In 0.3.0, `the_board_api_get` responses changed from a root array to an envelope (`{data, pagination, truncated}` for lists, `{data}` for a single record), and the default format became concise (nulls omitted). For output closer to the previous format, pass `format: "detailed"` (the envelope is still applied). The bundled schema is now in v2 format (variants / enumLabels / responseFields).

## Development

```bash
git clone https://github.com/breakedge/the-board-mcp-server.git
cd the-board-mcp-server
npm install
cp .env.example .env  # Edit with your API credentials
npm run dev
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

---

[日本語版 README はこちら](README.md)
