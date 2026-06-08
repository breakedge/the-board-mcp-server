# the board MCP Server

[![CI](https://github.com/breakedge/the-board-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/breakedge/the-board-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@breakedge/the-board-mcp-server.svg)](https://www.npmjs.com/package/@breakedge/the-board-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An unofficial [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [board](https://the-board.jp/) — a cloud-based invoicing and project management SaaS by VELC Inc.

> **Disclaimer**: This project is not affiliated with or endorsed by VELC Inc. board® is a trademark of VELC Inc.

> **Data Safety**: This server can access and modify financial data (invoices, estimates, purchase orders). Use with caution. Read-only mode is enabled by default.

## Features

- Access all 89 endpoints of the board API v1.6.0 via 6 generic MCP tools
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
| `the_board_api_get` | GET request — retrieve resources (single or list) |
| `the_board_api_post` | POST request — create resources |
| `the_board_api_patch` | PATCH request — update resources, change status, lock/unlock |
| `the_board_api_delete` | DELETE request — delete resources |
| `the_board_api_list_paths` | Search available API endpoints |
| `the_board_auth_status` | Check authentication status and rate limit remaining |

> **Note**: Write tools are registered only when the matching flag is set. `the_board_api_post` / `the_board_api_patch` appear with `--enable-writes`, and `the_board_api_delete` with `--enable-destructive-writes`. In the default read-only mode, only the GET, `list_paths`, and `auth_status` tools are available.

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
