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

export async function makeApiRequest(
	method: string,
	path: string,
	params?: Record<string, unknown>,
	body?: unknown,
): Promise<unknown> {
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
					// 配列値は board (Rails) の `key[]=A&key[]=B` 形式に合わせて同名キーを繰り返す。
					// String(array) だと "A,B" の 1 値に潰れフィルタが効かなくなるため。
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
				return null;
			}

			if (response.ok) {
				return response.json();
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
			);
		}, 3);
	} finally {
		releaseList?.();
	}
}
