import { describe, expect, it, vi } from "vitest";
import {
	applyFields,
	buildListEnvelope,
	buildSingleEnvelope,
	maxResponseChars,
	omitNulls,
	parseFields,
	toPaginationInfo,
} from "../../src/utils/shape.js";

describe("parseFields", () => {
	it("配列・カンマ区切り文字列を正規化し、重複と空要素を除く", () => {
		expect(parseFields(["id", " name ", "id"])).toEqual(["id", "name"]);
		expect(parseFields("id, name,,total")).toEqual(["id", "name", "total"]);
		expect(parseFields(undefined)).toBeUndefined();
		expect(parseFields("")).toBeUndefined();
		expect(parseFields([])).toBeUndefined();
	});
});

describe("applyFields", () => {
	const record = {
		id: 1,
		name: "案件A",
		client: { id: 10, name: "顧客", custom_no: "" },
		estimate: { id: 5, details: [{ no: 1, price: "100", description: "a" }] },
		tags: [],
	};

	it("トップレベルとドットパスで絞り込み、祖先オブジェクトを残す", () => {
		const { value, unknownFields } = applyFields(record, ["id", "client.name"]);
		expect(value).toEqual({ id: 1, client: { name: "顧客" } });
		expect(unknownFields).toEqual([]);
	});

	it("リストは各要素に適用する", () => {
		const { value } = applyFields([record, { ...record, id: 2 }], ["id"]);
		expect(value).toEqual([{ id: 1 }, { id: 2 }]);
	});

	it("パス途中の配列は各要素に適用する", () => {
		const { value } = applyFields(record, ["estimate.details.price"]);
		expect(value).toEqual({ estimate: { details: [{ price: "100" }] } });
	});

	it("親と子を同時に指定したら親を丸ごと返し、子も既知扱い", () => {
		const { value, unknownFields } = applyFields(record, ["client", "client.name"]);
		expect(value).toEqual({ client: { id: 10, name: "顧客", custom_no: "" } });
		expect(unknownFields).toEqual([]);
	});

	it("存在しないパスは無視して unknownFields に列挙する", () => {
		const { value, unknownFields } = applyFields([record], ["id", "nope", "client.zzz"]);
		expect(value).toEqual([{ id: 1, client: {} }]);
		expect(unknownFields).toEqual(["nope", "client.zzz"]);
	});

	it("途中が null なら潜らず null のまま残す", () => {
		const { value } = applyFields({ contact: null }, ["contact.name"]);
		expect(value).toEqual({ contact: null });
	});
});

describe("omitNulls", () => {
	it("null のキーだけを再帰的に省き、空配列・0・false・空文字は残す", () => {
		expect(
			omitNulls({ a: null, b: 0, c: false, d: "", e: [], f: { g: null, h: [null, 1] } }),
		).toEqual({ b: 0, c: false, d: "", e: [], f: { h: [null, 1] } });
	});
});

describe("buildListEnvelope", () => {
	const pagination = { totalCount: 25, page: 1, perPage: 10 };

	it("data と pagination を持つ envelope を concise で返す", () => {
		const text = buildListEnvelope({
			data: [{ id: 1 }],
			pagination,
			format: "concise",
			maxChars: 20000,
		});
		expect(text).not.toContain("\n");
		expect(JSON.parse(text)).toEqual({
			data: [{ id: 1 }],
			pagination: {
				total_count: 25,
				page: 1,
				per_page: 10,
				returned_count: 1,
				has_more: true,
				next_page: 2,
			},
			truncated: false,
		});
	});

	it("最終ページは has_more=false で next_page を持たない", () => {
		const parsed = JSON.parse(
			buildListEnvelope({
				data: [{ id: 1 }],
				pagination: { totalCount: 21, page: 3, perPage: 10 },
				format: "concise",
				maxChars: 20000,
			}),
		);
		expect(parsed.pagination.has_more).toBe(false);
		expect(parsed.pagination).not.toHaveProperty("next_page");
	});

	it("detailed は pretty JSON", () => {
		const text = buildListEnvelope({ data: [{ id: 1 }], format: "detailed", maxChars: 20000 });
		expect(text).toContain("\n  ");
		expect(JSON.parse(text).data).toEqual([{ id: 1 }]);
	});

	it("上限超過時はレコード境界で末尾から落とし、truncated と notice を付ける", () => {
		const data = Array.from({ length: 10 }, (_, i) => ({ id: i, text: "x".repeat(100) }));
		const text = buildListEnvelope({ data, pagination, format: "concise", maxChars: 700 });
		expect(text.length).toBeLessThanOrEqual(700);
		const parsed = JSON.parse(text);
		expect(parsed.truncated).toBe(true);
		expect(parsed.data.length + parsed.dropped_in_page).toBe(10);
		expect(parsed.pagination.returned_count).toBe(parsed.data.length);
		expect(parsed.pagination).not.toHaveProperty("next_page");
		expect(parsed.notice).toContain("末尾");
		expect(parsed.data.every((r: { text: string }) => r.text.length === 100)).toBe(true);
	});

	it("1 件で超過しても 1 件は返し、fields を案内する", () => {
		const text = buildListEnvelope({
			data: [{ id: 1, text: "x".repeat(500) }],
			format: "concise",
			maxChars: 100,
		});
		const parsed = JSON.parse(text);
		expect(parsed.data).toHaveLength(1);
		expect(parsed.truncated).toBe(false);
		expect(parsed.notice).toContain("fields");
	});

	it("0 件のときは request を echo し validated=true", () => {
		const parsed = JSON.parse(
			buildListEnvelope({
				data: [],
				pagination: { totalCount: 0, page: 1, perPage: 10 },
				format: "concise",
				maxChars: 20000,
				request: { path: "/v1/projects", query: { name_cont: "x" } },
			}),
		);
		expect(parsed.request).toEqual({ path: "/v1/projects", query: { name_cont: "x" } });
		expect(parsed.validated).toBe(true);
		expect(parsed.pagination.total_count).toBe(0);
	});

	it("unknown_fields があれば載せる", () => {
		const parsed = JSON.parse(
			buildListEnvelope({ data: [], format: "concise", maxChars: 20000, unknownFields: ["zz"] }),
		);
		expect(parsed.unknown_fields).toEqual(["zz"]);
	});

	it("concise は data の null キーを省くが 0/false/空文字/空配列は残す", () => {
		const parsed = JSON.parse(
			buildListEnvelope({
				data: [{ id: 1, memo: null, count: 0, active: false, note: "", tags: [] }],
				format: "concise",
				maxChars: 20000,
			}),
		);
		expect(parsed.data).toEqual([{ id: 1, count: 0, active: false, note: "", tags: [] }]);
	});

	it("detailed は null キーを残す", () => {
		const parsed = JSON.parse(
			buildListEnvelope({
				data: [{ id: 1, memo: null }],
				format: "detailed",
				maxChars: 20000,
			}),
		);
		expect(parsed.data).toEqual([{ id: 1, memo: null }]);
	});
});

describe("buildSingleEnvelope", () => {
	it("data を包み、超過時は切らずに notice を付ける", () => {
		const parsed = JSON.parse(
			buildSingleEnvelope({
				data: { id: 1, text: "x".repeat(300) },
				format: "concise",
				maxChars: 100,
			}),
		);
		expect(parsed.data.text.length).toBe(300);
		expect(parsed.notice).toContain("fields");
	});

	it("concise は data の null キーを省く", () => {
		const parsed = JSON.parse(
			buildSingleEnvelope({ data: { id: 1, memo: null }, format: "concise", maxChars: 20000 }),
		);
		expect(parsed.data).toEqual({ id: 1 });
	});
});

describe("toPaginationInfo", () => {
	it("perPage 不在時は returnedCount を仮の per_page として has_more を判定し、per_page キーは出さない", () => {
		expect(toPaginationInfo({ totalCount: 25, page: 1 }, 10)).toEqual({
			total_count: 25,
			page: 1,
			returned_count: 10,
			has_more: true,
			next_page: 2,
		});
		expect(toPaginationInfo({ totalCount: 10, page: 1 }, 10)).toEqual({
			total_count: 10,
			page: 1,
			returned_count: 10,
			has_more: false,
		});
	});
});

describe("maxResponseChars", () => {
	it("環境変数が無ければ 20000、正の整数なら採用、不正なら既定", () => {
		vi.unstubAllEnvs();
		expect(maxResponseChars()).toBe(20000);
		vi.stubEnv("THE_BOARD_MAX_RESPONSE_CHARS", "500");
		expect(maxResponseChars()).toBe(500);
		vi.stubEnv("THE_BOARD_MAX_RESPONSE_CHARS", "abc");
		expect(maxResponseChars()).toBe(20000);
		vi.unstubAllEnvs();
	});
});
