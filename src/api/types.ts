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
