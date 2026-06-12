import {
	ConcurrentListLimiter,
	DailyCounter,
	PerSecondLimiter,
	withRetry,
} from "./rate-limiter.js";
import { type ApiErrorResponse, TheBoardApiError } from "./types.js";

function sanitizeErrorMessage(message: string, apiKey: string, apiToken: string): string {
	let sanitized = message;
	sanitized = sanitized.replaceAll(apiKey, "[REDACTED_API_KEY]");
	sanitized = sanitized.replaceAll(`Bearer ${apiToken}`, "Bearer [REDACTED_TOKEN]");
	sanitized = sanitized.replaceAll(apiToken, "[REDACTED_TOKEN]");
	sanitized = sanitized.replace(
		/Authorization: Bearer \S+/g,
		"Authorization: Bearer [REDACTED_TOKEN]",
	);
	return sanitized;
}

function sanitizeBody(body: unknown, apiKey: string, apiToken: string): unknown {
	if (body === null || body === undefined) return body;
	const serialized = JSON.stringify(body);
	const sanitized = sanitizeErrorMessage(serialized, apiKey, apiToken);
	try {
		return JSON.parse(sanitized);
	} catch {
		return sanitized;
	}
}

// モジュールスコープのシングルトン rate limiter
const DAILY_LIMIT = 3000;
const perSecondLimiter = new PerSecondLimiter(3);
const dailyCounter = new DailyCounter(DAILY_LIMIT);
const concurrentListLimiter = new ConcurrentListLimiter(4);

/**
 * 現在の rate limit 状態を返す (auth_status 用)。
 * dailyRequestsRemaining はプロセス単位のカウンタに基づく推定値
 * (再起動でリセット、UTC 日付で reset)。
 */
export function getRateLimitStatus(): {
	dailyRequestsRemaining: number;
	dailyRequestLimit: number;
} {
	return {
		dailyRequestsRemaining: dailyCounter.remaining,
		dailyRequestLimit: DAILY_LIMIT,
	};
}

export interface Pagination {
	totalCount: number;
	page?: number;
	perPage?: number;
}

export interface ApiResult {
	data: unknown;
	pagination?: Pagination;
}

/** board のページネーションヘッダ (X-Total-Count / X-Page / X-Per-Page) を抽出する。 */
function extractPagination(headers: Headers): Pagination | undefined {
	const total = headers.get("X-Total-Count");
	if (total === null) {
		return undefined;
	}
	const pagination: Pagination = { totalCount: Number(total) };
	const page = headers.get("X-Page");
	if (page !== null) pagination.page = Number(page);
	const perPage = headers.get("X-Per-Page");
	if (perPage !== null) pagination.perPage = Number(perPage);
	return pagination;
}

export async function makeApiRequest(
	method: string,
	path: string,
	params?: Record<string, unknown>,
	body?: unknown,
): Promise<ApiResult> {
	const apiKey = process.env.THE_BOARD_API_KEY;
	const apiToken = process.env.THE_BOARD_API_TOKEN;
	const baseUrl = process.env.THE_BOARD_API_BASE_URL ?? "https://api.the-board.jp";

	if (!apiKey) {
		throw new Error("THE_BOARD_API_KEY environment variable is not set");
	}
	if (!apiToken) {
		throw new Error("THE_BOARD_API_TOKEN environment variable is not set");
	}

	// Rate limiting
	dailyCounter.increment();
	await perSecondLimiter.acquire();

	const isListReq = concurrentListLimiter.isListPath(path);
	let releaseList: (() => void) | undefined;
	if (isListReq) {
		releaseList = await concurrentListLimiter.acquire();
	}

	try {
		return await withRetry(async () => {
			const url = new URL(path, baseUrl);

			if (params) {
				for (const [key, value] of Object.entries(params)) {
					// null / undefined は「未指定」とみなし送信しない(=null 等の誤値を防ぐ)。
					if (value === null || value === undefined) {
						continue;
					}
					// 配列値は同名キーを繰り返して付与する。board (Rails) は配列パラメータを
					// `tags[]=A&tags[]=B` 形式で受けるため、呼び出し側が `tags[]` のように
					// `[]` 付きキーを渡す前提(String(array) だと "A,B" に潰れてしまう)。
					// 要素が非スカラの場合は handler 側の validateQuery が事前に弾く。
					if (Array.isArray(value)) {
						for (const v of value) {
							url.searchParams.append(key, String(v));
						}
					} else {
						url.searchParams.set(key, String(value));
					}
				}
			}

			const headers: Record<string, string> = {
				"x-api-key": apiKey,
				Authorization: `Bearer ${apiToken}`,
			};

			if (body !== undefined) {
				headers["Content-Type"] = "application/json";
			}

			const response = await fetch(url.toString(), {
				method,
				headers,
				body: body !== undefined ? JSON.stringify(body) : undefined,
			});

			if (response.status === 204) {
				return { data: null };
			}

			if (response.ok) {
				const data = await response.json();
				const pagination = extractPagination(response.headers);
				return pagination ? { data, pagination } : { data };
			}

			// Error response
			let errorMessage: string;
			let errorBody: unknown;

			try {
				errorBody = await response.json();
				const parsed = errorBody as ApiErrorResponse;
				errorMessage = parsed.message ?? response.statusText;
			} catch {
				errorBody = null;
				errorMessage = response.statusText;
			}

			const sanitized = sanitizeErrorMessage(errorMessage, apiKey, apiToken);
			throw new TheBoardApiError(
				sanitized,
				response.status,
				sanitizeBody(errorBody, apiKey, apiToken),
				method,
				path,
			);
		}, 3);
	} finally {
		releaseList?.();
	}
}
