import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import {
	handleAuthStatus,
	handleDelete,
	handleGet,
	handleListPaths,
	handlePatch,
	handlePost,
} from "../openapi/client-mode.js";
import { loadSchema } from "../openapi/schema-loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")) as {
	version: string;
};

const INSTRUCTIONS = `You are connected to board (the-board.jp) MCP server.

## How to use
1. Use the_board_api_list_paths to discover available API endpoints
2. Use the_board_auth_status to check authentication status
3. Use the_board_api_get (and write tools when enabled) to interact with the API

## Path format
- All paths start with /v1/
- Example: /v1/clients, /v1/projects/123, /v1/invoices

## Pagination
- Use query parameters: per_page (default varies), page (1-based)
- Use response_group: small (default), medium, large

## Write operations
- Read-only mode is enabled by default, so only GET tools are available.
- Write tools are registered only when the server is started with the matching flag:
  - the_board_api_post / the_board_api_patch require --enable-writes (or THE_BOARD_ENABLE_WRITES=true)
  - the_board_api_delete requires --enable-destructive-writes (or THE_BOARD_ENABLE_DESTRUCTIVE_WRITES=true)
- If a write tool is not in your tool list, ask the user to restart the server with the appropriate flag.

## Important
- Financial data (invoices, estimates) requires careful handling`;

export async function createMcpServer(config: Config): Promise<McpServer> {
	const schema = await loadSchema();

	const server = new McpServer(
		{
			name: "the-board-mcp-server",
			version: pkg.version,
		},
		{
			instructions: INSTRUCTIONS,
		},
	);

	// z.preprocess で JSON文字列 → object 変換
	const coercibleRecord = z.preprocess(
		(val) => {
			if (typeof val === "string") {
				try {
					return JSON.parse(val);
				} catch {
					return val;
				}
			}
			return val;
		},
		z.record(z.string(), z.unknown()),
	);

	// list_paths
	server.tool(
		"the_board_api_list_paths",
		"Search available API endpoints. Use this first to discover paths.",
		{
			method: z.string().optional().describe("HTTP method filter (GET, POST, PATCH, DELETE)"),
			keyword: z.string().optional().describe("Search keyword for path or summary"),
		},
		{
			title: "List available API endpoints",
			readOnlyHint: true,
			openWorldHint: false,
		},
		(args) => handleListPaths(args, config, schema),
	);

	// get
	server.tool(
		"the_board_api_get",
		"Send GET request to the board API. Retrieves resources (single or list).",
		{
			path: z.string().describe("API path (e.g., /v1/clients, /v1/projects/123)"),
			query: coercibleRecord.optional().describe("Query parameters"),
		},
		{ title: "Get resource from the board API", readOnlyHint: true },
		(args) => handleGet(args as { path: string; query?: Record<string, unknown> }, config, schema),
	);

	// post / patch は書き込みが有効な場合のみ登録 (read-only 時は LLM から不可視)
	if (config.enableWrites) {
		server.tool(
			"the_board_api_post",
			"Send POST request to the board API. Creates new resources.",
			{
				path: z.string().describe("API path (e.g., /v1/clients)"),
				body: coercibleRecord.describe("Request body"),
			},
			{ title: "Create resource in board", destructiveHint: false },
			(args) => handlePost(args as { path: string; body: Record<string, unknown> }, config, schema),
		);

		server.tool(
			"the_board_api_patch",
			"Send PATCH request to the board API. Updates resources (incl. status/lock changes).",
			{
				path: z.string().describe("API path (e.g., /v1/clients/123)"),
				body: coercibleRecord.describe("Request body"),
			},
			{
				title: "Update resource in board",
				// 破壊的書き込み有効時はこの PATCH ツールが lock/status 変更も実行しうるため、
				// その場合は destructive として正しく通知する
				destructiveHint: config.enableDestructiveWrites,
				idempotentHint: true,
			},
			(args) =>
				handlePatch(args as { path: string; body: Record<string, unknown> }, config, schema),
		);
	}

	// delete は破壊的書き込みが有効な場合のみ登録
	if (config.enableDestructiveWrites) {
		server.tool(
			"the_board_api_delete",
			"Send DELETE request to the board API. Deletes resources permanently.",
			{
				path: z.string().describe("API path (e.g., /v1/clients/123)"),
			},
			{
				title: "Delete resource from board",
				destructiveHint: true,
				idempotentHint: true,
			},
			(args) => handleDelete(args, config, schema),
		);
	}

	// auth_status
	server.tool(
		"the_board_auth_status",
		"Check the board API authentication status and rate limit remaining.",
		{},
		{
			title: "Check the board API authentication status",
			readOnlyHint: true,
		},
		() => handleAuthStatus(),
	);

	return server;
}
