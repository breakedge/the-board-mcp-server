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

export interface ApiErrorResponse {
	error?: string;
	message?: string;
	errors?: Record<string, string[]>;
}
