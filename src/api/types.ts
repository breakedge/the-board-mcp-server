export class TheBoardApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly body: unknown,
		public readonly method?: string,
		public readonly path?: string,
	) {
		super(message);
		this.name = "TheBoardApiError";
	}
}

/**
 * プロセス内で数える日次上限に達したときのエラー (D1)。リモートの 429 と違い
 * 待っても当日中は回復しないため、withRetry はこれをリトライせず即座に返す。
 */
export class TheBoardLocalLimitError extends TheBoardApiError {
	constructor(message: string) {
		super(message, 429, null);
		this.name = "TheBoardLocalLimitError";
	}
}

/**
 * board API が timeout した場合のエラー。想定内の失敗として扱い、
 * 「予期しないエラー」ではなくそのままの案内を AI に返せるようにする (D1)。
 */
export class TheBoardTimeoutError extends Error {
	constructor(
		message: string,
		public readonly method?: string,
		public readonly path?: string,
	) {
		super(message);
		this.name = "TheBoardTimeoutError";
	}
}

export interface ApiErrorResponse {
	error?: string;
	message?: string;
	errors?: Record<string, string[]>;
}
