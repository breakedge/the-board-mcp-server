import { TheBoardApiError } from "./types.js";

/**
 * スライディングウィンドウ方式で1秒間のリクエスト数を制限する
 */
export class PerSecondLimiter {
	private readonly maxPerSecond: number;
	private timestamps: number[] = [];

	constructor(maxPerSecond: number) {
		this.maxPerSecond = maxPerSecond;
	}

	async acquire(): Promise<void> {
		const now = Date.now();
		const windowStart = now - 1000;

		// 1秒より古いタイムスタンプを削除
		this.timestamps = this.timestamps.filter((t) => t > windowStart);

		if (this.timestamps.length < this.maxPerSecond) {
			this.timestamps.push(now);
			return;
		}

		// スロットが空くまで待機（最も古いタイムスタンプから1秒後）
		const oldest = this.timestamps[0];
		const waitMs = oldest + 1000 - Date.now();

		await new Promise<void>((resolve) => setTimeout(resolve, waitMs > 0 ? waitMs : 0));

		// 再帰的に取得を試みる
		return this.acquire();
	}
}

/**
 * UTC日付単位でリクエスト数を制限する
 */
export class DailyCounter {
	private readonly maxPerDay: number;
	private count = 0;
	private currentUtcDate: string;

	constructor(maxPerDay: number) {
		this.maxPerDay = maxPerDay;
		this.currentUtcDate = this.getUtcDateString();
	}

	private getUtcDateString(): string {
		const now = new Date(Date.now());
		return now.toISOString().slice(0, 10); // "YYYY-MM-DD"
	}

	private resetIfNewDay(): void {
		const today = this.getUtcDateString();
		if (today !== this.currentUtcDate) {
			this.count = 0;
			this.currentUtcDate = today;
		}
	}

	increment(): void {
		this.resetIfNewDay();

		if (this.count >= this.maxPerDay) {
			throw new TheBoardApiError("Daily request limit exceeded", 429, null);
		}
		this.count++;
	}

	get remaining(): number {
		this.resetIfNewDay();
		return this.maxPerDay - this.count;
	}
}

const LIST_PATHS = new Set([
	"/v1/projects",
	"/v1/invoices",
	"/v1/project_costs",
	"/v1/expenditures",
	"/v1/expenditure_payments",
]);

/**
 * リスト系APIの同時実行数を制限する
 */
export class ConcurrentListLimiter {
	private readonly maxConcurrent: number;
	private current = 0;
	private queue: Array<() => void> = [];

	constructor(maxConcurrent: number) {
		this.maxConcurrent = maxConcurrent;
	}

	isListPath(path: string): boolean {
		return LIST_PATHS.has(path);
	}

	async acquire(): Promise<() => void> {
		if (this.current < this.maxConcurrent) {
			this.current++;
			return this.buildRelease();
		}

		// スロットが空くまでキューで待機
		await new Promise<void>((resolve) => {
			this.queue.push(resolve);
		});

		this.current++;
		return this.buildRelease();
	}

	private buildRelease(): () => void {
		return () => {
			this.current--;
			const next = this.queue.shift();
			if (next) {
				next();
			}
		};
	}
}

/**
 * 429エラー時にexponential backoffでリトライする
 */
export async function withRetry<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const result = await new Promise<{ ok: true; value: T } | { ok: false; err: unknown }>(
			(resolve) => {
				fn().then(
					(value) => resolve({ ok: true, value }),
					(err) => resolve({ ok: false, err }),
				);
			},
		);

		if (result.ok) {
			return result.value;
		}

		const { err } = result;
		if (err instanceof TheBoardApiError && err.status === 429) {
			lastError = err;
			if (attempt < maxRetries) {
				const delay = 2 ** attempt * 1000;
				await new Promise<void>((resolve) => setTimeout(resolve, delay));
			}
		} else {
			throw err;
		}
	}

	throw lastError;
}
