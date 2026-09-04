import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getRateLimitStatus, makeApiRequest, redactSecrets } from "../api/client.js";
import { TheBoardApiError } from "../api/types.js";
import { ALL_TOOLSETS, type Config, type Toolset } from "../config.js";
import { createErrorResponse, createTextResponse, formatApiError } from "../utils/response.js";
import {
	applyFields,
	buildListEnvelope,
	buildSingleEnvelope,
	maxResponseChars,
	parseFields,
	type ResponseFormat,
} from "../utils/shape.js";
import { aliasesForPath } from "./aliases.js";
import { validateQueryValues } from "./query-validate.js";
import { getKnownQueryParams, getOperation, sanitizePath, validatePath } from "./schema-loader.js";
import { isPathEnabled } from "./toolsets.js";
import type { MinimalParameter, MinimalSchema } from "./types.js";

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
			// 配列要素は URL に直列化できるスカラのみ許可(allowlist)。
			// object/配列/null だけでなく undefined/bigint/symbol 等も String() で壊れるため弾く。
			const isScalar = (v: unknown) =>
				typeof v === "string" || typeof v === "number" || typeof v === "boolean";
			if (value.some((v) => !isScalar(v))) {
				return `クエリパラメータ "${key}" の配列要素は文字列・数値・真偽値のみ指定できます(オブジェクト・配列・null 等は不可)。`;
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

/**
 * 明細 (details) を送っているのに total が未指定/0 の場合の警告を返す (B0-3)。
 * board は明細から合計を自動集計しないため、これは「明細はあるが total=0」という
 * サイレントに不整合な財務書類を生む。書き込み成功とは別に AI へ注意喚起する。
 */
function documentTotalWarning(body: Record<string, unknown>): string | null {
	const details = body.details;
	if (!Array.isArray(details) || details.length === 0) {
		return null;
	}
	const total = body.total;
	if (total === undefined || total === null || total === 0 || total === "0") {
		return `警告: 明細 ${details.length} 行を送信しましたが total が未指定または 0 です。board は明細から合計を自動集計しないため、明示送信しない限り文書の total/tax は 0 のままになります。total(税抜)と tax を指定してください。`;
	}
	return null;
}

/** 書き込み結果を、必要なら警告を別 content block として先頭に付けて返す。 */
function writeResponse(result: unknown, body: Record<string, unknown>): CallToolResult {
	const text = formatWriteResult(result);
	const warning = documentTotalWarning(body);
	if (warning) {
		return {
			content: [
				{ type: "text", text: warning },
				{ type: "text", text },
			],
		};
	}
	return createTextResponse(text);
}

const DESTRUCTIVE_PATH_PATTERNS = [
	"/lock_flg/",
	"/invoice_status/",
	"/order_status/",
	"/expenditure_status/",
	"/payment_status/",
];

/** enum を持つパラメータを "値:ラベル" 短縮表記の文字列にまとめる。enum が無ければ undefined。 */
function enumShortForm(p: MinimalParameter): string | undefined {
	if (!p.enum || p.enum.length === 0) return undefined;
	return p.enum
		.map((v) => (p.enumLabels?.[String(v)] ? `${v}:${p.enumLabels[String(v)]}` : String(v)))
		.join("|");
}

export function handleListPaths(
	args: { method?: string; keyword?: string; detail?: boolean },
	config: Config,
	schema: MinimalSchema,
): CallToolResult {
	const tokens = (args.keyword ?? "")
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 0);

	const entries: {
		method: string;
		path: string;
		summary: string;
		aliases: string[];
		parameters?: MinimalParameter[];
	}[] = [];

	for (const [path, pathObj] of Object.entries(schema.paths)) {
		// 無効な toolset に属するパスは列挙しない
		if (!isPathEnabled(path, config.toolsets)) continue;
		const aliases = aliasesForPath(path);
		for (const [method, operation] of Object.entries(pathObj)) {
			const upperMethod = method.toUpperCase();
			if (args.method && upperMethod !== args.method.toUpperCase()) continue;
			const summary = operation.summary ?? "";
			if (tokens.length > 0) {
				const haystack = [
					path,
					summary,
					...aliases,
					...(operation.parameters ?? []).map((p) => p.name),
				]
					.join(" ")
					.toLowerCase();
				if (!tokens.some((t) => haystack.includes(t))) continue;
			}
			entries.push({
				method: upperMethod,
				path,
				summary,
				aliases,
				parameters: operation.parameters,
			});
		}
	}

	let text: string;
	if (entries.length === 0) {
		text =
			"該当する endpoint はありません。keyword を変える (英語・日本語どちらでも可) か、引数なしで全件を確認してください。";
	} else if (args.detail) {
		text = JSON.stringify(
			entries.map((e) => ({
				method: e.method,
				path: e.path,
				summary: e.summary,
				aliases: e.aliases,
				...(e.parameters && e.parameters.length > 0
					? {
							parameters: e.parameters.map((p) => {
								const values = enumShortForm(p);
								return {
									name: p.name,
									required: p.required,
									type: p.type,
									...(values ? { values } : {}),
								};
							}),
						}
					: {}),
			})),
		);
	} else {
		text = entries
			.map(
				(e) =>
					`${e.method} ${e.path} ${e.summary}${e.aliases.length > 0 ? ` [${e.aliases.join(", ")}]` : ""}`,
			)
			.join("\n");
	}

	const response = createTextResponse(text);
	// toolsets で絞り込み中は、隠れた endpoint がある旨を AI に伝える (B3-6)。
	if (config.toolsets.length < ALL_TOOLSETS.length) {
		response.content.push({
			type: "text",
			text: `注記: 有効な toolset (${config.toolsets.join(", ")}) で絞り込み中のため、一部の endpoint は表示されていません。必要なら運用者に --toolsets の追加を依頼してください。`,
		});
	}
	return response;
}

/**
 * 指定 endpoint の契約(クエリパラメータ + requestBody フィールド)を同梱スキーマから返す。
 * AI が外部 OpenAPI を取得せずにボディ構造・enum・必須項目を把握できるようにする (B1-2)。
 */
export function handleDescribe(
	args: { path: string; method: string; variant?: string; part?: string },
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

	const method = args.method.toUpperCase();
	const found = getOperation(method, sanitized, schema);
	if (!found) {
		return createErrorResponse(`エンドポイントが見つかりません: ${method} ${sanitized}`);
	}
	const { pattern, operation } = found;
	const part = args.part === "response" || args.part === "all" ? args.part : "request";

	// variant は part に関わらず検証する。variants を持たない endpoint への指定や未知の title を
	// (part=response 時などに) 黙って無視すると、AI が「variant 適用済み」と誤認しうるため。
	if (args.variant) {
		if (!operation.variants || operation.variants.length === 0) {
			return createErrorResponse(`このエンドポイントに variant はありません: ${method} ${pattern}`);
		}
		if (!operation.variants.some((v) => v.title === args.variant)) {
			const titles = operation.variants.map((v) => v.title);
			return createErrorResponse(
				`variant "${args.variant}" はありません。指定できる variant: ${titles.join(", ")}`,
			);
		}
	}

	const out: Record<string, unknown> = { path: pattern, method, summary: operation.summary };
	if (part !== "response") {
		if (operation.parameters) out.parameters = operation.parameters;
		if (operation.requestBody) out.requestBody = operation.requestBody;
		if (operation.variants && operation.variants.length > 0) {
			if (args.variant) {
				out.variant = operation.variants.find((v) => v.title === args.variant);
			} else {
				const titles = operation.variants.map((v) => v.title);
				out.variants = operation.variants.map((v) => ({
					title: v.title,
					required: v.required ?? [],
					fields: v.properties.map((p) => p.name),
				}));
				out.notice = `請求方式などで必須項目が異なります。variant (${titles.join(" / ")}) を指定すると該当分岐のフィールド定義 (型・説明) を返します。`;
			}
		}
	}
	if (part !== "request") {
		out.responseFields = operation.responseFields ?? [];
	}
	return createTextResponse(JSON.stringify(out));
}

export async function handleGet(
	args: { path: string; query?: Record<string, unknown>; format?: string; fields?: unknown },
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

	if (args.query) {
		const found = getOperation("GET", sanitized, schema);
		if (found?.operation.parameters) {
			const valueError = validateQueryValues(args.query, found.operation.parameters);
			if (valueError) {
				return createErrorResponse(valueError);
			}
		}
	}

	const format: ResponseFormat = args.format === "detailed" ? "detailed" : "concise";
	const fields = parseFields(args.fields);
	const maxChars = maxResponseChars();

	try {
		const { data, pagination } = await makeApiRequest("GET", sanitized, args.query);
		const projected = fields ? applyFields(data, fields) : { value: data, unknownFields: [] };
		if (Array.isArray(projected.value)) {
			return createTextResponse(
				buildListEnvelope({
					data: projected.value,
					pagination,
					format,
					maxChars,
					unknownFields: projected.unknownFields,
					request: { path: sanitized, query: args.query },
				}),
			);
		}
		return createTextResponse(
			buildSingleEnvelope({
				data: projected.value,
				format,
				maxChars,
				unknownFields: projected.unknownFields,
			}),
		);
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
		const { data } = await makeApiRequest("POST", sanitized, undefined, args.body);
		return writeResponse(data, args.body);
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
		const { data } = await makeApiRequest("PATCH", sanitized, undefined, args.body);
		return writeResponse(data, args.body);
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
		const { data } = await makeApiRequest("DELETE", sanitized);
		return createTextResponse(formatWriteResult(data));
	} catch (err) {
		return createErrorResponse(formatApiError(err));
	}
}

// validate 用の probe エンドポイント。有効な toolset 内の軽量 GET を選び、
// 運用者が無効化した toolset のエンドポイントを検証で叩かないようにする。
const VALIDATION_PROBES: { toolset: Toolset; path: string }[] = [
	{ toolset: "customers", path: "/v1/clients" },
	{ toolset: "projects", path: "/v1/projects" },
	{ toolset: "master", path: "/v1/users" },
	{ toolset: "payees", path: "/v1/payees" },
	{ toolset: "expenditures", path: "/v1/expenditures" },
	{ toolset: "documents", path: "/v1/invoices" },
	{ toolset: "analytics", path: "/v1/analyses" },
];

function validationProbePath(config?: Config): string {
	if (config) {
		for (const probe of VALIDATION_PROBES) {
			if (config.toolsets.includes(probe.toolset)) return probe.path;
		}
	}
	// config 無し / 全 toolset が未知 (理論上起きない) 時のフォールバック
	return "/v1/clients";
}

export async function handleAuthStatus(
	args: { validate?: boolean } = {},
	config?: Config,
): Promise<CallToolResult> {
	const apiKeyConfigured = Boolean(process.env.THE_BOARD_API_KEY);
	const apiTokenConfigured = Boolean(process.env.THE_BOARD_API_TOKEN);
	const { dailyRequestsRemaining, dailyRequestLimit } = getRateLimitStatus();

	const status: Record<string, unknown> = {
		apiKeyConfigured,
		apiTokenConfigured,
		dailyRequestsRemaining,
		dailyRequestLimit,
	};

	// validate=true のときだけ軽量 GET で資格情報の有効性を実検証する (B3-4)。
	// 既定は副作用なし(env 変数の有無のみ)。検証はレート制限を 1 消費する。
	if (args.validate) {
		if (!apiKeyConfigured || !apiTokenConfigured) {
			status.credentialsValid = false;
		} else {
			try {
				await makeApiRequest("GET", validationProbePath(config), { per_page: 1 });
				status.credentialsValid = true;
			} catch (err) {
				if (err instanceof TheBoardApiError && err.status === 401) {
					// 401 = 認証失敗。資格情報そのものが無効。
					status.credentialsValid = false;
				} else if (err instanceof TheBoardApiError && err.status === 403) {
					// 403 = 認証は通ったが当該リソースの権限不足。資格情報自体は有効。
					status.credentialsValid = true;
				} else {
					// ネットワーク等で検証不能。誤って invalid 判定しないよう null とする。
					status.credentialsValid = null;
					status.validationError = err instanceof Error ? redactSecrets(err.message) : "unknown";
				}
			}
		}
	}

	return createTextResponse(JSON.stringify(status));
}
