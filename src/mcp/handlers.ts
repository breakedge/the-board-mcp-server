import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import {
	handleAuthStatus,
	handleDelete,
	handleDescribe,
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

export const INSTRUCTIONS = `You are connected to board (the-board.jp) MCP server.

## How to use
1. Use the_board_api_list_paths to discover endpoints. Each entry includes its query "parameters" (filter names) when available.
2. Use the_board_api_describe(path, method) to get an endpoint's full contract — query parameters with their enums, and request body fields (names, types, required, enums). Do this before any POST/PATCH so you can build a correct body without external docs.
3. Use the_board_auth_status to check authentication and remaining rate-limit quota.
4. Use the_board_api_get (and write tools when enabled) to interact with the API.

## Path format
- All paths start with /v1/ (e.g. /v1/clients, /v1/projects/123, /v1/invoices).

## Pagination and response_group
- Pagination query params: per_page, page (1-based).
- response_group controls how much each resource returns:
  - small (default), medium, large: increasing field detail.
  - all: includes related documents. REQUIRED to obtain document IDs (see below).
- Unknown query params are rejected with the list of valid params. Prefer the names shown by list_paths.
- List responses report pagination as a separate note (total count, current page, per_page). If you have not fetched every record, request the next page (page=N+1).

## Filter naming conventions (important — wrong names are otherwise silently ignored)
- Suffixes: _eq (exact), _cont (substring), _gteq / _lteq (range), _in[] (multi-select array).
- Use project_no_eq to filter projects by number. project_id does NOT work.
- The invoice list (/v1/invoices) filters projects via project_project_no_eq (nested entity prefix).
- Array filters use the [] suffix, e.g. tags[], order_status_in[]. Pass them as arrays: { "tags[]": ["a","b"] }.

## Document creation model (project-centric — documents are NOT created directly)
You cannot POST an estimate/invoice directly. The flow is:
1. POST /v1/projects to create a project. board auto-creates empty documents (estimate, and one invoice per invoice date). Set invoice_timing_kbn and, for split billing, invoice_dates[] AT CREATION — invoice_dates cannot be changed by a later PATCH.
2. GET /v1/projects/{id}?response_group=all to read the generated document IDs: .estimate.id, .invoices[].id, .order.id.
3. PATCH /v1/documents/estimates/{id} and PATCH /v1/documents/invoices/{id} to fill each document (details[], message, total, tax).

Note: the id from /v1/invoices is a billing id, which is NOT the same as the document id used by /v1/documents/invoices/{id}. Always take document IDs from the project's response_group=all output.

## Document fields
- Detail rows use document_detail_kbn: 1 = normal line, 2 = section heading (text in section_description), 3 = subtotal line.
- Document total (tax-exclusive) and tax are NOT auto-summed from details. You must compute and send total and tax explicitly, or the document will show 0.

## Write operations
- Read-only mode is enabled by default, so only GET tools are available.
- Write tools are registered only when the server is started with the matching flag:
  - the_board_api_post / the_board_api_patch require --enable-writes (or THE_BOARD_ENABLE_WRITES=true)
  - the_board_api_delete requires --enable-destructive-writes (or THE_BOARD_ENABLE_DESTRUCTIVE_WRITES=true)
- If a write tool is not in your tool list, ask the user to restart the server with the appropriate flag.
- Writes are not auto-retried except on rate limits. If a write times out at the network level, do not blindly re-POST — first GET to check whether the resource was already created (avoids duplicate invoices/projects).

## Rate limits
- 3 requests/second and 3,000 requests/day. Check the_board_auth_status for remaining daily quota.

## Reference
- Full official OpenAPI spec (request/response schemas): https://developers.the-board.jp/doc/board_openapi.json
  (in that spec servers.url is /v1, so paths omit the leading /v1).

## Important
- Financial data (invoices, estimates) requires careful handling. After writing, re-read with response_group=all and verify total/tax are non-zero.`;

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

	// describe — endpoint の契約 (parameters + requestBody フィールド) を返す introspection
	server.tool(
		"the_board_api_describe",
		"Describe one endpoint's contract: query parameters (with enums) and request body fields (names, types, required, enums). Use before POST/PATCH to build a correct body without external docs.",
		{
			path: z.string().describe("API path (e.g., /v1/projects, /v1/documents/estimates/123)"),
			method: z.string().describe("HTTP method (GET, POST, PATCH, DELETE)"),
		},
		{
			title: "Describe a board API endpoint",
			readOnlyHint: true,
			openWorldHint: false,
		},
		(args) => handleDescribe(args, config, schema),
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
		"Check the board API authentication status and rate limit remaining. Pass validate=true to verify the credentials actually work with a lightweight API call (consumes 1 request).",
		{
			validate: z
				.boolean()
				.optional()
				.describe("If true, make a lightweight GET to confirm credentials are valid"),
		},
		{
			title: "Check the board API authentication status",
			readOnlyHint: true,
		},
		(args) => handleAuthStatus(args),
	);

	// 案件中心モデルでの「見積 + 月次請求」作成手順を案内する prompt (B3-2)。
	server.prompt(
		"create_monthly_billing_project",
		"Step-by-step guide to create a board project with one estimate and monthly invoices (project-centric model).",
		{
			client_id: z.string().describe("顧客ID (client_id)"),
			project_name: z.string().describe("案件名"),
			months: z.string().describe("請求の月数 (例: 3)"),
		},
		({ client_id, project_name, months }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `board で「${project_name}」(顧客 client_id=${client_id})を、見積 1 件 + 月次請求 ${months} 件で作成してください。

board は書類を直接 POST できない案件中心モデルです。次の手順で進めてください:
1. the_board_api_describe("/v1/projects", "POST") でボディ項目を確認する。
2. POST /v1/projects で案件を作成。invoice_timing_kbn と、分割請求なら invoice_dates[] を ${months} 件分指定する(invoice_dates は作成後に変更不可)。これで空の見積・請求書が自動生成される。
3. GET /v1/projects/{id}?response_group=all で .estimate.id と .invoices[].id を取得する。
4. the_board_api_describe("/v1/documents/estimates/{id}", "PATCH") で details[] の項目を確認し、PATCH /v1/documents/estimates/{id} に details[](document_detail_kbn=1 の通常行)と total(税抜)・tax を明示送信する。total/tax は自動集計されない。
5. 各 PATCH /v1/documents/invoices/{id} を同様に埋める。
6. 最後に GET ?response_group=all で各書類の total/tax が 0 でないことを確認する。

書き込みツールが見つからない場合は、--enable-writes での再起動を依頼してください。`,
					},
				},
			],
		}),
	);

	return server;
}
