import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getRateLimitStatus, makeApiRequest } from "../api/client.js";
import type { Config } from "../config.js";
import { createErrorResponse, createTextResponse, formatApiError } from "../utils/response.js";
import { sanitizePath, validatePath } from "./schema-loader.js";
import { isPathEnabled } from "./toolsets.js";
import type { MinimalSchema } from "./types.js";

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
	const results: { method: string; path: string; summary: string }[] = [];

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

			results.push({ method: upperMethod, path, summary });
		}
	}

	return createTextResponse(JSON.stringify(results));
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
		return createTextResponse(JSON.stringify(result, null, 2));
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
		return createTextResponse(JSON.stringify(result, null, 2));
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
		return createTextResponse(JSON.stringify(result, null, 2));
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
