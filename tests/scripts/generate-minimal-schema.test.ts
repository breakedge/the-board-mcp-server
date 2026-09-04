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

describe("toFields — format 出力と type 推論", () => {
	it("format を出力し、type は明示値を優先する", () => {
		const schema: Json = {
			type: "object",
			properties: { estimate_date: { type: "string", format: "date" } },
		};
		const fields = toFields(schema, new Set(), 0);
		const f = fields.find((x) => x.name === "estimate_date");
		expect(f?.type).toBe("string");
		expect(f?.format).toBe("date");
	});

	it("type 省略時は items の有無から array を推論する", () => {
		const schema: Json = {
			type: "object",
			properties: { tags: { items: { type: "string" } } },
		};
		const f = toFields(schema, new Set(), 0).find((x) => x.name === "tags");
		expect(f?.type).toBe("array");
	});

	it("type 省略時は properties の有無から object を推論する", () => {
		const schema: Json = {
			type: "object",
			properties: { meta: { properties: { k: { type: "string" } } } },
		};
		const f = toFields(schema, new Set(), 0).find((x) => x.name === "meta");
		expect(f?.type).toBe("object");
	});

	it("format が無いフィールドには format を付けない", () => {
		const schema: Json = { type: "object", properties: { name: { type: "string" } } };
		const f = toFields(schema, new Set(), 0).find((x) => x.name === "name");
		expect(f?.format).toBeUndefined();
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

describe("resolveRef — spec 未ロード時の contract", () => {
	it("$ref 入りスキーマを import 経由 (spec 未ロード) で渡すと黙って欠落させず throw する", () => {
		// generator は spec をモジュールグローバルに持ち main() でのみ代入する。
		// export した関数を $ref 入りで呼ぶと従来は黙って {} を返し欠落していた。fail-loud を保証する。
		expect(() => flatten({ $ref: "#/components/schemas/Foo" }, new Set())).toThrow(
			/spec not loaded/i,
		);
	});
});

import { extractParameters, parseDescription } from "../../scripts/generate-minimal-schema.js";

describe("parseDescription — 説明文の整形と enum 構造化", () => {
	it("「- 1：ラベル」列挙を enum / enumLabels に構造化し、説明文から除く", () => {
		const r = parseDescription(
			"請求ステータス - 1：未請求 - 4：請求OK - 2：請求済 ※複数の場合はカンマ区切り ※例にはURLエンコード前の値が記載されていますが、送信する際はURLエンコードしてください。",
		);
		expect(r.enum).toEqual([1, 4, 2]);
		expect(r.enumLabels).toEqual({ "1": "未請求", "4": "請求OK", "2": "請求済" });
		expect(r.description).toBe("請求ステータス ※複数指定は配列で渡す");
	});

	it("括弧付きラベルも 1 語として扱う", () => {
		const r = parseDescription("受注ステータス - 1：見積中(高) - 2：見積中(中) - 9：失注");
		expect(r.enumLabels).toEqual({ "1": "見積中(高)", "2": "見積中(中)", "9": "失注" });
		expect(r.description).toBe("受注ステータス");
	});

	it("列挙が 1 つだけなら enum 化しない", () => {
		const r = parseDescription("備考 - 1：メモ");
		expect(r.enum).toBeUndefined();
		expect(r.description).toBe("備考 - 1：メモ");
	});

	it("「＊10・8・5・0のいずれか」から enum を復元する", () => {
		const r = parseDescription("税率 ＊10・8・5・0のいずれかを設定してください");
		expect(r.enum).toEqual([10, 8, 5, 0]);
		expect(r.description).toBe("税率 ＊10・8・5・0のいずれかを設定してください");
	});

	it("空・非文字列は空オブジェクト", () => {
		expect(parseDescription(undefined)).toEqual({});
		expect(parseDescription("   ")).toEqual({});
	});

	it("200 字で切り詰める", () => {
		const r = parseDescription("あ".repeat(250));
		expect(r.description?.length).toBe(201);
		expect(r.description?.endsWith("…")).toBe(true);
	});
});

describe("toFields — v2 の補正", () => {
	it("type=string なのに items を持つ矛盾は items を落とす", () => {
		const fields = toFields(
			{
				type: "object",
				properties: {
					invoice_date: { type: "string", format: "YYYY-MM-DD", items: { type: "string" } },
				},
			},
			new Set(),
			0,
		);
		expect(fields[0]).toEqual({ name: "invoice_date", type: "string", format: "YYYY-MM-DD" });
	});

	it("説明文の列挙を enum / enumLabels としてフィールドに載せる", () => {
		const fields = toFields(
			{
				type: "object",
				properties: {
					document_detail_kbn: {
						type: "integer",
						description: "明細区分 - 1：通常 - 2：見出し行 - 3：小計行",
					},
				},
			},
			new Set(),
			0,
		);
		expect(fields[0].enum).toEqual([1, 2, 3]);
		expect(fields[0].enumLabels).toEqual({ "1": "通常", "2": "見出し行", "3": "小計行" });
		expect(fields[0].description).toBe("明細区分");
	});
});

import { extractVariants, splitVariants } from "../../scripts/generate-minimal-schema.js";

// 公式 spec の POST /projects と同じ形: anyOf の各分岐が { allOf: [{ title, allOf: [...] }, { required }] }
const projectsCreateLike: Json = {
	anyOf: [
		{
			allOf: [
				{
					title: "共通",
					allOf: [
						{
							properties: {
								name: { type: "string", description: "案件名" },
								client_id: { type: "integer" },
								invoice_timing_kbn: {
									type: "integer",
									description: "請求方式 - 1：一括 - 2：定期 - 3：分割",
								},
							},
						},
					],
				},
				{ required: ["name", "client_id", "invoice_timing_kbn"] },
			],
		},
		{
			allOf: [
				{
					title: "一括請求",
					allOf: [{ properties: { invoice_date: { type: "string", format: "YYYY-MM-DD" } } }],
				},
				{ required: ["invoice_date"] },
			],
		},
		{
			allOf: [
				{
					title: "定期請求",
					allOf: [
						{
							properties: {
								contract_start_date: { type: "string" },
								periodical_invoice_interval: { type: "integer" },
							},
						},
					],
				},
				{ required: ["contract_start_date"] },
			],
		},
	],
};

describe("splitVariants / extractVariants — title 付き anyOf", () => {
	it("「共通」分岐と title 付き分岐に分ける", () => {
		const split = splitVariants(projectsCreateLike);
		expect(split).not.toBeNull();
		expect(split?.common).not.toBeNull();
		expect(split?.variants.map((v) => v.title)).toEqual(["一括請求", "定期請求"]);
	});

	it("title の無い分岐が 1 つでもあれば null (従来の union にフォールバック)", () => {
		expect(
			splitVariants({ anyOf: [{ title: "A", properties: { a: {} } }, { properties: { b: {} } }] }),
		).toBeNull();
		expect(splitVariants({ type: "object", properties: {} })).toBeNull();
	});

	it("extractRequestBody は共通部分だけを返す", () => {
		const body = extractRequestBody({
			requestBody: { content: { "application/json": { schema: projectsCreateLike } } },
		});
		expect(body?.properties.map((p) => p.name)).toEqual([
			"name",
			"client_id",
			"invoice_timing_kbn",
		]);
		expect(body?.required).toEqual(["name", "client_id", "invoice_timing_kbn"]);
		expect(body?.properties[2].enumLabels).toEqual({ "1": "一括", "2": "定期", "3": "分割" });
	});

	it("extractVariants は variant ごとのフィールドと required を返す", () => {
		const variants = extractVariants({
			requestBody: { content: { "application/json": { schema: projectsCreateLike } } },
		});
		expect(variants).toHaveLength(2);
		expect(variants?.[0]).toEqual({
			title: "一括請求",
			required: ["invoice_date"],
			properties: [{ name: "invoice_date", type: "string", format: "YYYY-MM-DD", required: true }],
		});
		expect(variants?.[1].properties.map((p) => p.name)).toEqual([
			"contract_start_date",
			"periodical_invoice_interval",
		]);
	});

	it("title の無い anyOf は従来どおり union し variants は undefined", () => {
		const op = {
			requestBody: {
				content: {
					"application/json": {
						schema: {
							anyOf: [
								{ type: "object", required: ["a"], properties: { a: { type: "string" } } },
								{ type: "object", properties: { b: { type: "string" } } },
							],
						},
					},
				},
			},
		};
		expect(extractRequestBody(op)?.properties.map((p) => p.name)).toEqual(["a", "b"]);
		expect(extractVariants(op)).toBeUndefined();
	});
});

describe("extractParameters — query パラメータの enum 構造化", () => {
	it("schema.enum が無くても説明文の列挙から enum を作る", () => {
		const params = extractParameters({
			parameters: [
				{
					name: "invoice_status_in[]",
					in: "query",
					schema: { type: "string" },
					description: "請求ステータス - 1：未請求 - 2：請求済 ※複数の場合はカンマ区切り",
				},
				{ name: "id", in: "path", schema: { type: "integer" } },
			],
		});
		expect(params).toHaveLength(1);
		expect(params?.[0]).toEqual({
			name: "invoice_status_in[]",
			required: false,
			type: "string",
			enum: [1, 2],
			enumLabels: { "1": "未請求", "2": "請求済" },
			description: "請求ステータス ※複数指定は配列で渡す",
		});
	});

	it("schema.enum があればそれを優先し、ラベルだけ説明文から補う", () => {
		const params = extractParameters({
			parameters: [
				{
					name: "response_group",
					in: "query",
					schema: { type: "string", enum: ["small", "medium", "large"] },
					description: "取得範囲",
				},
			],
		});
		expect(params?.[0].enum).toEqual(["small", "medium", "large"]);
		expect(params?.[0].enumLabels).toBeUndefined();
	});
});
