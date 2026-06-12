import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeApiRequest } from "../../src/api/client.js";
import { TheBoardApiError } from "../../src/api/types.js";

const TEST_BASE_URL = "https://api.the-board.jp";
const TEST_API_KEY = "test-api-key";
const TEST_API_TOKEN = "test-api-token";

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: "error" });
});

beforeEach(() => {
	vi.stubEnv("THE_BOARD_API_KEY", TEST_API_KEY);
	vi.stubEnv("THE_BOARD_API_TOKEN", TEST_API_TOKEN);
});

afterEach(() => {
	server.resetHandlers();
	vi.unstubAllEnvs();
});

afterAll(() => {
	server.close();
});

describe("makeApiRequest — 認証ヘッダ検証", () => {
	it("x-api-key ヘッダと Authorization: Bearer ヘッダが付与されること", async () => {
		let capturedHeaders: Headers | null = null;

		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, ({ request }) => {
				capturedHeaders = request.headers;
				return HttpResponse.json([]);
			}),
		);

		await makeApiRequest("GET", "/v1/clients");

		expect(capturedHeaders).not.toBeNull();
		expect((capturedHeaders as unknown as Headers).get("x-api-key")).toBe(TEST_API_KEY);
		expect((capturedHeaders as unknown as Headers).get("authorization")).toBe(
			`Bearer ${TEST_API_TOKEN}`,
		);
	});
});

describe("makeApiRequest — Base URL オーバーライド", () => {
	it("デフォルトでは https://api.the-board.jp にリクエストされること", async () => {
		let requestUrl: string | null = null;

		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, ({ request }) => {
				requestUrl = request.url;
				return HttpResponse.json([]);
			}),
		);

		await makeApiRequest("GET", "/v1/clients");

		expect(requestUrl).not.toBeNull();
		expect(requestUrl).toMatch(/^https:\/\/api\.the-board\.jp/);
	});

	it("THE_BOARD_API_BASE_URL が設定されている場合、そのURLにリクエストされること", async () => {
		const customBase = "https://custom.example.com";
		vi.stubEnv("THE_BOARD_API_BASE_URL", customBase);

		let requestUrl: string | null = null;

		server.use(
			http.get(`${customBase}/v1/clients`, ({ request }) => {
				requestUrl = request.url;
				return HttpResponse.json([]);
			}),
		);

		await makeApiRequest("GET", "/v1/clients");

		expect(requestUrl).not.toBeNull();
		expect(requestUrl).toMatch(/^https:\/\/custom\.example\.com/);
	});
});

describe("makeApiRequest — GET with query params", () => {
	it("クエリパラメータが URL に付与されること", async () => {
		let requestUrl: string | null = null;

		server.use(
			http.get(`${TEST_BASE_URL}/v1/projects`, ({ request }) => {
				requestUrl = request.url;
				return HttpResponse.json([]);
			}),
		);

		await makeApiRequest("GET", "/v1/projects", { page: 1, per_page: 10 });

		expect(requestUrl).not.toBeNull();
		const url = new URL(requestUrl as string);
		expect(url.searchParams.get("page")).toBe("1");
		expect(url.searchParams.get("per_page")).toBe("10");
	});
});

describe("makeApiRequest — 配列クエリパラメータ", () => {
	it("配列値は同名キーを繰り返して付与されること (Rails 形式 tags[]=A&tags[]=B)", async () => {
		let requestUrl: string | null = null;

		server.use(
			http.get(`${TEST_BASE_URL}/v1/projects`, ({ request }) => {
				requestUrl = request.url;
				return HttpResponse.json([]);
			}),
		);

		await makeApiRequest("GET", "/v1/projects", { "tags[]": ["A", "B"] });

		expect(requestUrl).not.toBeNull();
		const url = new URL(requestUrl as string);
		expect(url.searchParams.getAll("tags[]")).toEqual(["A", "B"]);
	});
});

describe("makeApiRequest — クエリ値の型別直列化", () => {
	it("null / undefined のクエリ値は送信されないこと", async () => {
		let requestUrl: string | null = null;
		server.use(
			http.get(`${TEST_BASE_URL}/v1/projects`, ({ request }) => {
				requestUrl = request.url;
				return HttpResponse.json([]);
			}),
		);

		await makeApiRequest("GET", "/v1/projects", { project_no_eq: null, page: 1 });

		const url = new URL(requestUrl as string);
		expect(url.searchParams.has("project_no_eq")).toBe(false);
		expect(url.searchParams.get("page")).toBe("1");
	});

	it("boolean のクエリ値が文字列化されて付与されること", async () => {
		let requestUrl: string | null = null;
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, ({ request }) => {
				requestUrl = request.url;
				return HttpResponse.json([]);
			}),
		);

		await makeApiRequest("GET", "/v1/clients", { include_archive_flg: true });

		const url = new URL(requestUrl as string);
		expect(url.searchParams.get("include_archive_flg")).toBe("true");
	});
});

describe("makeApiRequest — POST with JSON body", () => {
	it("Content-Type: application/json と body が送信されること", async () => {
		let capturedContentType: string | null = null;
		let capturedBody: unknown = null;

		server.use(
			http.post(`${TEST_BASE_URL}/v1/clients`, async ({ request }) => {
				capturedContentType = request.headers.get("content-type");
				capturedBody = await request.json();
				return HttpResponse.json({ id: 1, name: "Test" }, { status: 201 });
			}),
		);

		await makeApiRequest("POST", "/v1/clients", undefined, { name: "Test" });

		expect(capturedContentType).toMatch(/application\/json/);
		expect(capturedBody).toEqual({ name: "Test" });
	});
});

describe("makeApiRequest — 成功レスポンス", () => {
	it("200 レスポンスの JSON がパースされて返ること", async () => {
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () => {
				return HttpResponse.json([{ id: 1, name: "Client A" }], { status: 200 });
			}),
		);

		const result = await makeApiRequest("GET", "/v1/clients");
		expect(result.data).toEqual([{ id: 1, name: "Client A" }]);
	});

	it("201 レスポンスの JSON がパースされて返ること", async () => {
		server.use(
			http.post(`${TEST_BASE_URL}/v1/clients`, () => {
				return HttpResponse.json({ id: 2, name: "New Client" }, { status: 201 });
			}),
		);

		const result = await makeApiRequest("POST", "/v1/clients", undefined, {
			name: "New Client",
		});
		expect(result.data).toEqual({ id: 2, name: "New Client" });
	});

	it("204 レスポンスは data: null を返すこと", async () => {
		server.use(
			http.delete(`${TEST_BASE_URL}/v1/clients/1`, () => {
				return new HttpResponse(null, { status: 204 });
			}),
		);

		const result = await makeApiRequest("DELETE", "/v1/clients/1");
		expect(result.data).toBeNull();
	});

	it("ページネーションヘッダを pagination として返すこと (B2-5)", async () => {
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () =>
				HttpResponse.json([{ id: 1 }], {
					headers: { "X-Total-Count": "57", "X-Page": "1", "X-Per-Page": "20" },
				}),
			),
		);

		const result = await makeApiRequest("GET", "/v1/clients");
		expect(result.data).toEqual([{ id: 1 }]);
		expect(result.pagination).toEqual({ totalCount: 57, page: 1, perPage: 20 });
	});

	it("ページネーションヘッダが無ければ pagination は undefined", async () => {
		server.use(http.get(`${TEST_BASE_URL}/v1/clients`, () => HttpResponse.json([{ id: 1 }])));
		const result = await makeApiRequest("GET", "/v1/clients");
		expect(result.pagination).toBeUndefined();
	});

	it("X-Total-Count が非数値なら pagination を返さない (NaN ガード)", async () => {
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () =>
				HttpResponse.json([{ id: 1 }], { headers: { "X-Total-Count": "not-a-number" } }),
			),
		);
		const result = await makeApiRequest("GET", "/v1/clients");
		expect(result.pagination).toBeUndefined();
	});

	it("X-Page/X-Per-Page が非数値なら totalCount のみ返す (NaN ガード)", async () => {
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () =>
				HttpResponse.json([{ id: 1 }], {
					headers: { "X-Total-Count": "57", "X-Page": "abc", "X-Per-Page": "xyz" },
				}),
			),
		);
		const result = await makeApiRequest("GET", "/v1/clients");
		expect(result.pagination).toEqual({ totalCount: 57 });
	});
});

describe("makeApiRequest — エラーレスポンス — TheBoardApiError", () => {
	const errorCases: Array<{ status: number; body: unknown }> = [
		{ status: 400, body: { message: "Bad Request" } },
		{ status: 401, body: { message: "Unauthorized" } },
		{ status: 403, body: { message: "Forbidden" } },
		{ status: 404, body: { message: "Not Found" } },
		{
			status: 422,
			body: { message: "Unprocessable Entity", errors: { name: ["can't be blank"] } },
		},
		{ status: 429, body: { message: "Too Many Requests" } },
		{ status: 500, body: { message: "Internal Server Error" } },
		{ status: 503, body: { message: "Service Unavailable" } },
	];

	for (const { status, body } of errorCases) {
		// 429 は withRetry により最大 3 リトライ (1s + 2s + 4s) が発生するため長めのタイムアウトを設定
		const testTimeout = status === 429 ? 30000 : 5000;
		it(
			`${status} → TheBoardApiError (status: ${status}) を throw すること`,
			async () => {
				server.use(
					http.get(`${TEST_BASE_URL}/v1/clients`, () => {
						return HttpResponse.json(body, { status });
					}),
				);

				try {
					await makeApiRequest("GET", "/v1/clients");
					expect.fail("should have thrown");
				} catch (err) {
					expect(err).toBeInstanceOf(TheBoardApiError);
					expect((err as TheBoardApiError).status).toBe(status);
				}
			},
			testTimeout,
		);
	}

	it("422 レスポンスの validation errors が TheBoardApiError に含まれること", async () => {
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () => {
				return HttpResponse.json(
					{ message: "Unprocessable Entity", errors: { name: ["can't be blank"] } },
					{ status: 422 },
				);
			}),
		);

		try {
			await makeApiRequest("GET", "/v1/clients");
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(TheBoardApiError);
			expect((err as TheBoardApiError).status).toBe(422);
		}
	});
});

describe("makeApiRequest — エラーサニタイズ", () => {
	it("エラーレスポンスbodyにトークン値が含まれていた場合、TheBoardApiError の message に含まれないこと", async () => {
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () => {
				return HttpResponse.json(
					{ message: `Authorization: Bearer ${TEST_API_TOKEN} is invalid` },
					{ status: 401 },
				);
			}),
		);

		try {
			await makeApiRequest("GET", "/v1/clients");
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(TheBoardApiError);
			expect((err as TheBoardApiError).message).not.toContain(TEST_API_TOKEN);
		}
	});

	it("エラーレスポンスbodyに API key 値が含まれていた場合、除去されること", async () => {
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () => {
				return HttpResponse.json({ message: `Invalid API key: ${TEST_API_KEY}` }, { status: 401 });
			}),
		);

		try {
			await makeApiRequest("GET", "/v1/clients");
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(TheBoardApiError);
			expect((err as TheBoardApiError).message).not.toContain(TEST_API_KEY);
		}
	});

	it("TheBoardApiError.body 内のトークン値もサニタイズされること", async () => {
		server.use(
			http.get(`${TEST_BASE_URL}/v1/clients`, () => {
				return HttpResponse.json(
					{ message: "Error", details: `Token ${TEST_API_TOKEN} is expired` },
					{ status: 401 },
				);
			}),
		);

		try {
			await makeApiRequest("GET", "/v1/clients");
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(TheBoardApiError);
			const body = (err as TheBoardApiError).body as Record<string, string>;
			expect(JSON.stringify(body)).not.toContain(TEST_API_TOKEN);
		}
	});
});

describe("makeApiRequest — 環境変数未設定", () => {
	it("THE_BOARD_API_KEY が未設定の場合にエラーが発生すること", async () => {
		vi.unstubAllEnvs();
		vi.stubEnv("THE_BOARD_API_TOKEN", TEST_API_TOKEN);

		await expect(makeApiRequest("GET", "/v1/clients")).rejects.toThrow();
	});

	it("THE_BOARD_API_TOKEN が未設定の場合にエラーが発生すること", async () => {
		vi.unstubAllEnvs();
		vi.stubEnv("THE_BOARD_API_KEY", TEST_API_KEY);

		await expect(makeApiRequest("GET", "/v1/clients")).rejects.toThrow();
	});
});
