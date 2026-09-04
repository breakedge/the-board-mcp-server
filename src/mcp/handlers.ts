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
	handleValidateWrite,
} from "../openapi/client-mode.js";
import { loadSchema } from "../openapi/schema-loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")) as {
	version: string;
};

export const INSTRUCTIONS = `You are connected to board (the-board.jp) MCP server. board is a Japanese SaaS for estimates, invoices and project (案件) management.

## Tools and order of use
1. the_board_api_list_paths — find endpoints (one line each; keyword accepts English/Japanese words and filter names, e.g. "sales", "請求"). detail=true adds enums.
2. the_board_api_describe(path, method) — full contract: query parameters (enum values, labels), request body fields, variants. part=response shows response fields.
3. the_board_api_get — read. validate_write — dry-run a POST/PATCH body (read-only OK). Write tools (post/patch/delete) need the matching flag.
4. the_board_auth_status — credentials and remaining daily quota (estimate).

## Quick map: what you want → endpoint + filters
- Monthly sales / 売上・計上ベースの集計: GET /v1/analyses with report_ym_gteq / report_ym_lteq (YYYY-MM) and analysis_data_kbn_in[]=["1"] (1 = 案件, 2 = 案件原価, 3 = 発注). Records carry report_date (YYYY-MM-DD), not report_ym — group by its first 7 chars for monthly totals; fields ["report_date","total","tax"]. total is per record — sum yourself.
- Invoices by date / 請求書一覧: GET /v1/invoices with invoice_date_gteq/lteq (YYYY-MM-DD). invoice_status_in[] (1 未請求, 4 請求OK, 2 請求済, 5 一部入金済, 3 入金済, 9 回収不能). "一部入金済" counting as unpaid is a business call — ask the user.
- Find a customer / 顧客: GET /v1/clients with name_cont. Contacts / 担当者: GET /v1/contacts with client_id_eq.
- Projects of a customer / 案件: GET /v1/projects with client_id_eq, order_status_in[], name_cont. By number: project_no_eq (project_id does NOT work). order_status: 4 = 受注確定, 5 = 受注済 — if the user says 受注済 案件, confirm whether 4 should be included.
- Document contents (estimate, invoice, order …): GET /v1/projects/{id} with query {"response_group":"all"}; fields is a separate tool argument (not query) — fields:["estimate"] keeps it small (id from /v1/invoices is a billing id, NOT the document id).
- Costs / 原価: /v1/project_costs. Purchases / 仕入・発注: /v1/expenditures. Masters: /v1/users, /v1/payment_terms, /v1/project_types.

## Response format
- GET returns JSON: {"data": [...] | {...}, "pagination": {total_count, page, per_page, returned_count, has_more, next_page}, "truncated": false, "notice"?: "..."} — notice (optional) explains truncation/caveats.
- Default format is concise: compact JSON with null keys omitted — a missing key means null; don't re-fetch as detailed just to confirm. detailed keeps nulls, pretty-printed.
- fields selects keys (dot paths, per record): fields=["id","name","total","tax"] or "estimate.details", for aggregation/large lists. Unknown keys are listed in unknown_fields.
- per_page max is 100 (default 10). Large pages are cut at record boundaries: truncated=true with dropped_in_page — lower per_page/fields and refetch, then next_page while has_more.
- Zero results include "request" (filters actually applied) and validated=true — a real empty result, not a wrong parameter.

## Data semantics
- Lists are returned newest first (新しい順; official spec for /v1/projects).
- total is tax-exclusive (税抜); tax is separate (spec-verified for projects, observed elsewhere). Money values are decimal strings ("500000.0").
- Document detail rows: document_detail_kbn 1 = normal line, 2 = section heading (in section_description), 3 = subtotal. A kbn=1 row without price/quantity is a note line — don't total it.
- Filter suffixes: _eq (exact), _cont (substring), _gteq / _lteq (range), _in[] (array, e.g. {"invoice_status_in[]": ["2","5"]}). Unknown filter names/values are rejected with the valid list.

## Creating documents (project-centric)
Estimates/invoices cannot be POSTed directly:
1. describe("/v1/projects","POST") → pick the billing variant (一括請求 / 定期請求 / 分割請求) then describe again with variant for its required fields. invoice_timing_kbn selects the mode; some fields are creation-only.
2. validate_write("/v1/projects","POST", body, variant) until valid, then POST /v1/projects. board generates the documents (estimate, order, delivery, invoices depending on settings).
3. GET /v1/projects/{id} with query {"response_group":"all"} and fields ["estimate","order","invoices","deliveries"] to read document ids.
4. PATCH /v1/documents/estimates/{id} and /v1/documents/invoices/{id} with details[], total (税抜) and tax. total/tax are NOT auto-summed — send them or the document shows 0. details[] replace-vs-append unverified; re-read after write.
5. Verify with GET response_group=all.

## Write safety
- Read-only by default. post/patch need --enable-writes (or THE_BOARD_ENABLE_WRITES=true); delete and status/lock changes need --enable-destructive-writes. Missing write tool: ask the user to restart with the flag (validate_write names which).
- Writes are not auto-retried except on rate limits; after a network timeout, GET first to check whether the resource was created before re-POSTing.
- post/patch validate the body before sending; pass skip_validation=true only when the_board_api_validate_write reports an error you have confirmed is wrong (e.g. a stale bundled schema).

## Rate limits
- 3 requests/second, 3,000/day. auth_status shows an estimated remaining daily quota (resets on restart).

## Reference
- Official OpenAPI spec: https://developers.the-board.jp/doc/board_openapi.json (its paths omit the leading /v1).`;

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
		"Search available API endpoints (one line per endpoint: METHOD path summary [aliases]). keyword matches path, summary, English/Japanese aliases and query parameter names (space-separated words are OR). Set detail=true to get JSON with query parameters and enum values.",
		{
			method: z.string().optional().describe("HTTP method filter (GET, POST, PATCH, DELETE)"),
			keyword: z
				.string()
				.optional()
				.describe("Search words, e.g. 'invoice', 'sales', '請求', 'project_no_eq'"),
			detail: z
				.boolean()
				.optional()
				.describe("true: return JSON with parameters (names, types, enum values)"),
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
		"Describe one endpoint's contract: query parameters (with enum values and labels) and request body fields (names, types, required, enums). Endpoints whose body depends on a mode (e.g. POST /v1/projects by billing type) list variants; pass variant to get that branch's fields. part=response returns the response fields (name, type, meaning). Use before POST/PATCH to build a correct body without external docs.",
		{
			path: z.string().describe("API path (e.g., /v1/projects, /v1/documents/estimates/123)"),
			method: z.string().describe("HTTP method (GET, POST, PATCH, DELETE)"),
			variant: z
				.string()
				.optional()
				.describe("Variant title from a previous describe call (e.g. 一括請求)"),
			part: z
				.enum(["request", "response", "all"])
				.optional()
				.describe(
					"request (default): parameters and request body. response: response fields. all: both.",
				),
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
		'Send GET request to the board API. Returns JSON {data, pagination, truncated}. Default format is concise (compact JSON, null keys omitted). Use fields to return only the keys you need (e.g. ["id","name","total"]); large pages are cut at record boundaries with truncated=true.',
		{
			path: z.string().describe("API path (e.g., /v1/clients, /v1/projects/123)"),
			query: coercibleRecord.optional().describe("Query parameters"),
			format: z
				.enum(["concise", "detailed"])
				.optional()
				.describe(
					"concise (default): compact JSON, null keys omitted (a missing key means null). detailed: pretty JSON with nulls kept.",
				),
			fields: z
				.union([z.array(z.string()), z.string()])
				.optional()
				.describe(
					"Keys to return, dot paths allowed (e.g. id,name,client.name,estimate.details). Applied to each record; unknown keys are listed in unknown_fields.",
				),
		},
		{ title: "Get resource from the board API", readOnlyHint: true },
		(args) =>
			handleGet(
				args as {
					path: string;
					query?: Record<string, unknown>;
					format?: string;
					fields?: unknown;
				},
				config,
				schema,
			),
	);

	// post / patch は書き込みが有効な場合のみ登録 (read-only 時は LLM から不可視)
	if (config.enableWrites) {
		server.tool(
			"the_board_api_post",
			"Send POST request to the board API. Creates new resources.",
			{
				path: z.string().describe("API path (e.g., /v1/clients)"),
				body: coercibleRecord.describe("Request body"),
				variant: z
					.string()
					.optional()
					.describe(
						"Variant title (e.g. 一括請求) so that mode-specific required fields are checked before sending",
					),
				skip_validation: z
					.boolean()
					.optional()
					.describe(
						"true: skip the pre-send schema validation (use only when the bundled schema is stale and validate_write reports a false error)",
					),
			},
			{ title: "Create resource in board", destructiveHint: false },
			(args) =>
				handlePost(
					args as {
						path: string;
						body: Record<string, unknown>;
						variant?: string;
						skip_validation?: boolean;
					},
					config,
					schema,
				),
		);

		server.tool(
			"the_board_api_patch",
			"Send PATCH request to the board API. Updates resources (incl. status/lock changes).",
			{
				path: z.string().describe("API path (e.g., /v1/clients/123)"),
				body: coercibleRecord.describe("Request body"),
				variant: z
					.string()
					.optional()
					.describe(
						"Variant title (e.g. 一括請求) so that mode-specific required fields are checked before sending",
					),
				skip_validation: z
					.boolean()
					.optional()
					.describe(
						"true: skip the pre-send schema validation (use only when the bundled schema is stale and validate_write reports a false error)",
					),
			},
			{
				title: "Update resource in board",
				// 破壊的書き込み有効時はこの PATCH ツールが lock/status 変更も実行しうるため、
				// その場合は destructive として正しく通知する
				destructiveHint: config.enableDestructiveWrites,
				idempotentHint: true,
			},
			(args) =>
				handlePatch(
					args as {
						path: string;
						body: Record<string, unknown>;
						variant?: string;
						skip_validation?: boolean;
					},
					config,
					schema,
				),
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

	// validate_write — 送信せずに body を検証する dry-run (read-only でも常時登録)
	server.tool(
		"the_board_api_validate_write",
		"Dry-run validation of a POST/PATCH body against the bundled schema (required fields, enum values, types, variant-specific requirements). Never calls the API; works in read-only mode. Use it before the_board_api_post / the_board_api_patch, or to check a body when write tools are not enabled.",
		{
			path: z.string().describe("API path (e.g., /v1/projects, /v1/documents/estimates/123)"),
			method: z.enum(["POST", "PATCH"]).describe("HTTP method the body is for"),
			body: coercibleRecord.describe("Request body to validate"),
			variant: z
				.string()
				.optional()
				.describe("Variant title from the_board_api_describe (e.g. 一括請求)"),
		},
		{ title: "Validate a write body without sending it", readOnlyHint: true, openWorldHint: false },
		(args) =>
			handleValidateWrite(
				args as { path: string; method: string; body: Record<string, unknown>; variant?: string },
				config,
				schema,
			),
	);

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
		(args) => handleAuthStatus(args, config),
	);

	// 案件中心モデルでの書類作成手順 (案件作成 → 自動生成された書類を埋める) を案内する prompt (B3-2)。
	server.prompt(
		"create_project_with_documents",
		"Step-by-step guide to create a board project and fill its auto-generated documents (estimate, invoices) using the project-centric model.",
		{
			client_id: z.string().describe("顧客ID (client_id)"),
			project_name: z.string().describe("案件名"),
		},
		({ client_id, project_name }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `board で顧客 client_id=${client_id} の案件「${project_name}」を作成し、自動生成される書類(見積・請求書)を埋めてください。

board は書類を直接 POST できない案件中心モデルです。次の手順で進めてください:
1. the_board_api_describe("/v1/projects", "POST") で共通項目と variant(一括請求 / 定期請求 / 分割請求)を確認し、選んだ variant を指定してもう一度 describe して固有の必須項目を把握する。
2. the_board_api_validate_write("/v1/projects", "POST", body, variant) で valid になるまで body を直してから POST /v1/projects で案件を作成する。board が見積・請求書などを自動生成する。
3. GET /v1/projects/{id}?response_group=all で生成された書類ID(.estimate.id / .invoices[].id / .order.id)を取得する。
4. the_board_api_describe で各書類の PATCH エンドポイントの項目を確認し、PATCH /v1/documents/estimates/{id} や PATCH /v1/documents/invoices/{id} に details[](document_detail_kbn=1 の通常行)と total(税抜)・tax を明示送信する。total/tax は自動集計されない。
5. 最後に GET /v1/projects/{id}?response_group=all で各書類の内容(明細・金額)が意図どおりか検証する。

書き込みツールが見つからない場合は、--enable-writes での再起動を依頼してください。`,
					},
				},
			],
		}),
	);

	return server;
}
