import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ConcurrentListLimiter,
	DailyCounter,
	PerSecondLimiter,
	withRetry,
} from "../../src/api/rate-limiter.js";
import { TheBoardApiError } from "../../src/api/types.js";

describe("PerSecondLimiter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("3 req/sec 以内はすぐに実行されること", async () => {
		const limiter = new PerSecondLimiter(3);

		const p1 = limiter.acquire();
		const p2 = limiter.acquire();
		const p3 = limiter.acquire();

		await expect(Promise.race([p1, Promise.resolve("timeout")])).resolves.not.toBe("timeout");
		await expect(Promise.race([p2, Promise.resolve("timeout")])).resolves.not.toBe("timeout");
		await expect(Promise.race([p3, Promise.resolve("timeout")])).resolves.not.toBe("timeout");
	});

	it("4 番目のリクエストは待機すること", async () => {
		const limiter = new PerSecondLimiter(3);

		await limiter.acquire();
		await limiter.acquire();
		await limiter.acquire();

		let resolved = false;
		const p4 = limiter.acquire().then(() => {
			resolved = true;
		});

		// まだ resolve されていないこと
		await Promise.resolve();
		expect(resolved).toBe(false);

		// 1秒進めると resolve される
		await vi.advanceTimersByTimeAsync(1000);
		await p4;
		expect(resolved).toBe(true);
	});
});

describe("DailyCounter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("カウンターがインクリメントされること", () => {
		const counter = new DailyCounter(3000);
		counter.increment();
		expect(counter.remaining).toBe(2999);
	});

	it("上限に達したら TheBoardApiError (429) を投げること", () => {
		const counter = new DailyCounter(3);
		counter.increment();
		counter.increment();
		counter.increment();
		expect(() => counter.increment()).toThrow(TheBoardApiError);
	});

	it("UTC日付変更後にリセットされること", async () => {
		const now = new Date("2024-01-01T23:59:59.000Z");
		vi.setSystemTime(now);

		const counter = new DailyCounter(3);
		counter.increment();
		counter.increment();
		counter.increment();

		// 翌日のUTC 0:00に進める (1秒後)
		await vi.advanceTimersByTimeAsync(1000);

		// リセット後はインクリメントできること
		expect(() => counter.increment()).not.toThrow();
	});

	it("remaining が正しく返ること", () => {
		const counter = new DailyCounter(100);
		expect(counter.remaining).toBe(100);
		counter.increment();
		expect(counter.remaining).toBe(99);
	});
});

describe("ConcurrentListLimiter", () => {
	it("リスト系パスかどうかを判定できること", () => {
		const limiter = new ConcurrentListLimiter(4);
		expect(limiter.isListPath("/v1/projects")).toBe(true);
		expect(limiter.isListPath("/v1/invoices")).toBe(true);
		expect(limiter.isListPath("/v1/project_costs")).toBe(true);
		expect(limiter.isListPath("/v1/expenditures")).toBe(true);
		expect(limiter.isListPath("/v1/expenditure_payments")).toBe(true);
		expect(limiter.isListPath("/v1/clients")).toBe(false);
		expect(limiter.isListPath("/v1/projects/123")).toBe(false);
	});

	it("4同時実行まではすぐに実行されること", async () => {
		const limiter = new ConcurrentListLimiter(4);

		const p1 = limiter.acquire();
		const p2 = limiter.acquire();
		const p3 = limiter.acquire();
		const p4 = limiter.acquire();

		await expect(Promise.race([p1, Promise.resolve("timeout")])).resolves.not.toBe("timeout");
		await expect(Promise.race([p2, Promise.resolve("timeout")])).resolves.not.toBe("timeout");
		await expect(Promise.race([p3, Promise.resolve("timeout")])).resolves.not.toBe("timeout");
		await expect(Promise.race([p4, Promise.resolve("timeout")])).resolves.not.toBe("timeout");
	});

	it("5本目はキューイングされること", async () => {
		const limiter = new ConcurrentListLimiter(4);

		await limiter.acquire();
		await limiter.acquire();
		await limiter.acquire();
		const release4 = await limiter.acquire();

		let resolved = false;
		const p5 = limiter.acquire().then(() => {
			resolved = true;
		});

		// まだ resolve されていないこと
		await Promise.resolve();
		expect(resolved).toBe(false);

		// 1つ release すると resolve される
		release4();
		await p5;
		expect(resolved).toBe(true);
	});
});

describe("withRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("成功すればリトライしないこと", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const resultPromise = withRetry(fn, 3);
		const result = await resultPromise;
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("429 エラーで最大3回リトライすること (exponential backoff)", async () => {
		const err429 = new TheBoardApiError("Too Many Requests", 429, {});
		const fn = vi
			.fn()
			.mockRejectedValueOnce(err429)
			.mockRejectedValueOnce(err429)
			.mockResolvedValue("ok");

		const resultPromise = withRetry(fn, 3);

		// 1回目の失敗後、1秒待機
		await vi.advanceTimersByTimeAsync(1000);
		// 2回目の失敗後、2秒待機
		await vi.advanceTimersByTimeAsync(2000);

		const result = await resultPromise;
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("3回リトライ後も429の場合は TheBoardApiError を throw すること", async () => {
		const err429 = new TheBoardApiError("Too Many Requests", 429, {});
		const fn = vi.fn().mockRejectedValue(err429);

		let caughtError: unknown;
		const resultPromise = withRetry(fn, 3).catch((err) => {
			caughtError = err;
		});

		// exponential backoff: 1s, 2s, 4s
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(4000);

		await resultPromise;
		expect(caughtError).toBeInstanceOf(TheBoardApiError);
		expect(fn).toHaveBeenCalledTimes(4); // 初回 + 3回リトライ
	});

	it("429以外のエラーはリトライせず即座に throw すること", async () => {
		const err500 = new TheBoardApiError("Internal Server Error", 500, {});
		const fn = vi.fn().mockRejectedValue(err500);

		await expect(withRetry(fn, 3)).rejects.toThrow(TheBoardApiError);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
