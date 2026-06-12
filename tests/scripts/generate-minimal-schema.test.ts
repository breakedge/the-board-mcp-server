import { describe, expect, it } from "vitest";

// biome-ignore lint/suspicious/noExplicitAny: 合成 OpenAPI フラグメントを任意構造で渡すため
type Json = any;

import { extractRequestBody, flatten, toFields } from "../../scripts/generate-minimal-schema.js";

/**
 * generator の回帰テスト。
 *
 * 65828e0 で導入した「anyOf/oneOf を全枝 union する」挙動を将来のスキーマ再生成・
 * リファクタで静かに退行させないことを保証する。board の POST /v1/projects は請求形態別の
 * anyOf で構成され、基底枝に共通フィールド + 必須、後続枝に invoice_dates(分割請求)・
 * periodical_invoice_interval(定期請求)が分かれて入る。先頭枝のみだと後者が脱落する。
 */
describe("flatten — anyOf/oneOf の union", () => {
	// POST /v1/projects を模した anyOf 構造
	const projectsLike: Json = {
		anyOf: [
			{
				type: "object",
				required: ["name", "client_id", "user_id", "order_status", "invoice_timing_kbn"],
				properties: {
					name: { type: "string" },
					client_id: { type: "integer" },
					user_id: { type: "integer" },
					order_status: { type: "integer" },
					invoice_timing_kbn: { type: "integer" },
				},
			},
			{
				type: "object",
				properties: {
					invoice_dates: {
						type: "array",
						items: { type: "object", properties: { invoice_date: { type: "string" } } },
					},
				},
			},
			{
				type: "object",
				properties: { periodical_invoice_interval: { type: "integer" } },
			},
		],
	};

	it("全枝の properties を union する(後続枝のフィールドが脱落しない)", () => {
		const flat = flatten(projectsLike, new Set());
		const keys = Object.keys(flat.properties);
		expect(keys).toContain("name");
		expect(keys).toContain("invoice_dates"); // 後続枝(分割請求)
		expect(keys).toContain("periodical_invoice_interval"); // 後続枝(定期請求)
	});

	it("required は基底枝のまま(union で過剰必須化しない)", () => {
		const flat = flatten(projectsLike, new Set());
		expect(flat.required).toEqual([
			"name",
			"client_id",
			"user_id",
			"order_status",
			"invoice_timing_kbn",
		]);
	});

	it("入力スキーマを破壊しない(後続枝を呼び出し元の properties に書き戻さない)", () => {
		flatten(projectsLike, new Set());
		// 基底枝には依然として基底フィールドしか無いこと
		expect(Object.keys(projectsLike.anyOf[0].properties)).not.toContain("invoice_dates");
	});

	it("properties を持たないスカラ oneOf は先頭枝のみ採用する(従来挙動)", () => {
		const scalarOneOf: Json = { oneOf: [{ type: "string" }, { type: "integer" }] };
		const flat = flatten(scalarOneOf, new Set());
		expect(flat.type).toBe("string");
		expect(flat.properties).toBeUndefined();
	});
});

describe("extractRequestBody — readOnly 除外と required フィルタ", () => {
	function bodyOf(schema: Json) {
		return extractRequestBody({
			requestBody: { content: { "application/json": { schema } } },
		});
	}

	it("readOnly フィールドは書き込みボディから除外し、required からも落とす", () => {
		const schema: Json = {
			type: "object",
			required: ["id", "name"],
			properties: {
				id: { type: "integer", readOnly: true },
				name: { type: "string" },
			},
		};
		const body = bodyOf(schema);
		expect(body?.properties.map((p) => p.name)).toEqual(["name"]);
		// id は properties に無いので required からも除かれる
		expect(body?.required).toEqual(["name"]);
	});

	it("anyOf でも基底必須と全枝フィールドを併せ持つ(POST /v1/projects 形)", () => {
		const schema: Json = {
			anyOf: [
				{
					type: "object",
					required: ["name", "client_id"],
					properties: { name: { type: "string" }, client_id: { type: "integer" } },
				},
				{ type: "object", properties: { invoice_dates: { type: "array" } } },
			],
		};
		const body = bodyOf(schema);
		const names = body?.properties.map((p) => p.name);
		expect(names).toContain("name");
		expect(names).toContain("invoice_dates");
		expect(body?.required).toEqual(["name", "client_id"]);
	});
});

describe("toFields — allOf 平坦化", () => {
	it("allOf の properties / required をマージする", () => {
		const schema: Json = {
			allOf: [
				{ type: "object", required: ["a"], properties: { a: { type: "string" } } },
				{ type: "object", properties: { b: { type: "integer" } } },
			],
		};
		const fields = toFields(schema, new Set(), 0);
		const names = fields.map((f) => f.name);
		expect(names).toContain("a");
		expect(names).toContain("b");
		expect(fields.find((f) => f.name === "a")?.required).toBe(true);
	});
});
