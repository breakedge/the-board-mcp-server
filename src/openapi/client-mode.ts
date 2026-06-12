import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getRateLimitStatus, makeApiRequest } from "../api/client.js";
import type { Config } from "../config.js";
import { createErrorResponse, createTextResponse, formatApiError } from "../utils/response.js";
import {
	getKnownQueryParams,
	matchPathPattern,
	sanitizePath,
	validatePath,
} from "./schema-loader.js";
import { isPathEnabled } from "./toolsets.js";
import type { MinimalSchema } from "./types.js";

/**
 * クエリパラメータを送信前に検証する。問題があればエラーメッセージ、無ければ null。
 * - 値が(配列でない)オブジェクトは URL に直列化できず board 側で黙殺されるため拒否 (B0-4)。
 * - スキーマが parameters を宣言する endpoint では、未知キーを有効パラメータ一覧付きで拒否 (B0-1)。
 *   未知キーは board に無視され「フィルタ成功に見えて全件取得」のサイレント失敗を招くため。
 */
function validateQuery(
	method: string,
	path: string,
	query: Record<string, unknown>,
	schema: MinimalSchema,
): string | null {
	for (const [key, value] of Object.entries(query)) {
		if (Array.isArray(value)) {
			// 配列要素は URL に直列化できるスカラのみ許可(typeof null/配列/オブジェクト === "object")
			if (value.some((v) => typeof v === "object")) {
				return `クエリパラメータ "${key}" の配列要素は文字列・数値・真偽値のみ指定できます(オブジェクト・配列・null は不可)。`;
			}
		} else if (value !== null && typeof value === "object") {
			return `クエリパラメータ "${key}" にオブジェクトは指定できません。値は文字列・数値・真偽値・スカラ配列のいずれかにしてください。`;
		}
	}

	const known = getKnownQueryParams(method, path, schema);
	if (known) {
		const unknown = Object.keys(query).filter((k) => !known.has(k));
		if (unknown.length > 0) {
			return `不明なクエリパラメータ: ${unknown.join(", ")}。このエンドポイントの有効なパラメータ: ${[...known].join(", ")}`;
		}
	}

	return null;
}

/**
 * 書き込み系の結果を整形する。204 No Content (null) は文字列 "null" ではなく
 * 明示的な成功マーカーにして、AI が成否を判定できるようにする (B2-4)。
 */
function formatWriteResult(result: unknown): string {
	if (result === null) {
		return JSON.stringify({ success: true, message: "操作が完了しました (No Content)" });
	}
	return JSON.stringify(result, null, 2);
}

const DESTRUCTIVE_PATH_PATTERNS = [
	"/lock_flg/",
	"/invoice_status/",
	"/order_status/",
	"/expenditure_status/",
	"/payment_status/",
];

export function handleListPaths(
	args: { method?: string; keyword?: string },
	config: Config,
	schema: MinimalSchema,
): CallToolResult {
	const results: {
		method: string;
		path: string;
		summary: string;
		parameters?: MinimalSchema["paths"][string][string]["parameters"];
	}[] = [];

	for (const [path, pathObj] of Object.entries(schema.paths)) {
		// 無効な toolset に属するパスは列挙しない
		if (!isPathEnabled(path, config.toolsets)) {
			continue;
		}

		for (const [method, operation] of Object.entries(pathObj)) {
			const upperMethod = method.toUpperCase();
			const summary = operation.summary ?? "";

			if (args.method && upperMethod !== args.method.toUpperCase()) {
				continue;
			}

			if (args.keyword) {
				const kw = args.keyword.toLowerCase();
				if (!path.toLowerCase().includes(kw) && !summary.toLowerCase().includes(kw)) {
					continue;
				}
			}

			// スキーマが宣言するクエリパラメータ名を同梱し、AI が外部 OpenAPI を見ずに
			// フィルタ名 (project_no_eq 等) を発見できるようにする (B1-3)。
			// enum/説明などの詳細は discovery を軽量に保つため describe 側に委ねる。
			const entry: (typeof results)[number] = { method: upperMethod, path, summary };
			if (operation.parameters && operation.parameters.length > 0) {
				entry.parameters = operation.parameters.map((p) => ({
					name: p.name,
					required: p.required,
					type: p.type,
				}));
			}
			results.push(entry);
		}
	}

	return createTextResponse(JSON.stringify(results));
}

/**
 * 指定 endpoint の契約(クエリパラメータ + requestBody フィールド)を同梱スキーマから返す。
 * AI が外部 OpenAPI を取得せずにボディ構造・enum・必須項目を把握できるようにする (B1-2)。
 */
export function handleDescribe(
	args: { path: string; method: string },
	config: Config,
	schema: MinimalSchema,
): CallToolResult {
	let sanitized: string;
	try {
		sanitized = sanitizePath(args.path);
	} catch (err) {
		return createErrorResponse(err instanceof Error ? err.message : "Invalid path");
	}

	if (!isPathEnabled(sanitized, config.toolsets)) {
		return createErrorResponse(
			`このパスの toolset は無効です。--toolsets で有効化してください: ${sanitized}`,
		);
	}

	const pattern = matchPathPattern(sanitized, schema);
	const method = args.method.toUpperCase();
	const operation = pattern ? schema.paths[pattern]?.[method] : undefined;
	if (!pattern || !operation) {
		return createErrorResponse(`エンドポイントが見つかりません: ${method} ${sanitized}`);
	}

	return createTextResponse(
		JSON.stringify(
			{
				path: pattern,
				method,
				summary: operation.summary,
				parameters: operation.parameters,
				requestBody: operation.requestBody,
			},
			null,
			2,
		),
	);
}

export async function handleGet(
	args: { path: string; query?: Record<string, unknown> },
	config: Config,
	schema: MinimalSchema,
): Promise<CallToolResult> {
	let sanitized: string;
	try {
		sanitized = sanitizePath(args.path);
	} catch (err) {
		return createErrorResponse(err instanceof Error ? err.message : "Invalid path");
	}

	if (!isPathEnabled(sanitized, config.toolsets)) {
		return createErrorResponse(
			`このパスの toolset は無効です。--toolsets で有効化してください: ${sanitized}`,
		);
	}

	if (!validatePath("GET", sanitized, schema)) {
		return createErrorResponse(`パスが見つかりません: ${sanitized}`);
	}

	if (args.query) {
		const queryError = validateQuery("GET", sanitized, args.query, schema);
		if (queryError) {
			return createErrorResponse(queryError);
		}
	}

	try {
		const result = await makeApiRequest("GET", sanitized, args.query);
		return createTextResponse(JSON.stringify(result, null, 2));
	} catch (err) {
		return createErrorResponse(formatApiError(err));
	}
}

export async function handlePost(
	args: { path: string; body: Record<string, unknown> },
	config: Config,
	schema: MinimalSchema,
): Promise<CallToolResult> {
	if (config.readOnly || !config.enableWrites) {
		return createErrorResponse("書き込みが無効です。--enable-writes フラグを設定してください。");
	}

	let sanitized: string;
	try {
		sanitized = sanitizePath(args.path);
	} catch (err) {
		return createErrorResponse(err instanceof Error ? err.message : "Invalid path");
	}

	if (!isPathEnabled(sanitized, config.toolsets)) {
		return createErrorResponse(
			`このパスの toolset は無効です。--toolsets で有効化してください: ${sanitized}`,
		);
	}

	if (!validatePath("POST", sanitized, schema)) {
		return createErrorResponse(`パスが見つかりません: ${sanitized}`);
	}

	try {
		const result = await makeApiRequest("POST", sanitized, undefined, args.body);
		return createTextResponse(formatWriteResult(result));
	} catch (err) {
		return createErrorResponse(formatApiError(err));
	}
}

export async function handlePatch(
	args: { path: string; body: Record<string, unknown> },
	config: Config,
	schema: MinimalSchema,
): Promise<CallToolResult> {
	if (config.readOnly || !config.enableWrites) {
		return createErrorResponse("書き込みが無効です。--enable-writes フラグを設定してください。");
	}

	let sanitized: string;
	try {
		sanitized = sanitizePath(args.path);
	} catch (err) {
		return createErrorResponse(err instanceof Error ? err.message : "Invalid path");
	}

	if (!isPathEnabled(sanitized, config.toolsets)) {
		return createErrorResponse(
			`このパスの toolset は無効です。--toolsets で有効化してください: ${sanitized}`,
		);
	}

	const isDestructive = DESTRUCTIVE_PATH_PATTERNS.some((pattern) => sanitized.includes(pattern));
	if (isDestructive && !config.enableDestructiveWrites) {
		return createErrorResponse("この操作には --enable-destructive-writes フラグが必要です。");
	}

	if (!validatePath("PATCH", sanitized, schema)) {
		return createErrorResponse(`パスが見つかりません: ${sanitized}`);
	}

	try {
		const result = await makeApiRequest("PATCH", sanitized, undefined, args.body);
		return createTextResponse(formatWriteResult(result));
	} catch (err) {
		return createErrorResponse(formatApiError(err));
	}
}

export async function handleDelete(
	args: { path: string },
	config: Config,
	schema: MinimalSchema,
): Promise<CallToolResult> {
	if (config.readOnly || !config.enableWrites || !config.enableDestructiveWrites) {
		return createErrorResponse("DELETE には --enable-destructive-writes フラグが必要です。");
	}

	let sanitized: string;
	try {
		sanitized = sanitizePath(args.path);
	} catch (err) {
		return createErrorResponse(err instanceof Error ? err.message : "Invalid path");
	}

	if (!isPathEnabled(sanitized, config.toolsets)) {
		return createErrorResponse(
			`このパスの toolset は無効です。--toolsets で有効化してください: ${sanitized}`,
		);
	}

	if (!validatePath("DELETE", sanitized, schema)) {
		return createErrorResponse(`パスが見つかりません: ${sanitized}`);
	}

	try {
		const result = await makeApiRequest("DELETE", sanitized);
		return createTextResponse(formatWriteResult(result));
	} catch (err) {
		return createErrorResponse(formatApiError(err));
	}
}

export function handleAuthStatus(): CallToolResult {
	const apiKeyConfigured = Boolean(process.env.THE_BOARD_API_KEY);
	const apiTokenConfigured = Boolean(process.env.THE_BOARD_API_TOKEN);
	const { dailyRequestsRemaining, dailyRequestLimit } = getRateLimitStatus();

	return createTextResponse(
		JSON.stringify({
			apiKeyConfigured,
			apiTokenConfigured,
			dailyRequestsRemaining,
			dailyRequestLimit,
		}),
	);
}
