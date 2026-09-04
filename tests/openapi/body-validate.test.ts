import { describe, expect, it } from "vitest";
import { formatBodyIssues, validateBody } from "../../src/openapi/body-validate.js";
import type { MinimalOperation } from "../../src/openapi/types.js";

const projectsPost: MinimalOperation = {
	summary: "案件登録",
	requestBody: {
		required: ["name", "client_id", "invoice_timing_kbn"],
		properties: [
			{ name: "name", type: "string", required: true },
			{ name: "client_id", type: "integer", required: true },
			{
				name: "invoice_timing_kbn",
				type: "integer",
				required: true,
				enum: [1, 2, 3],
				enumLabels: { "1": "一括", "2": "定期", "3": "分割" },
			},
			{ name: "tags", type: "array", items: { type: "string" } },
		],
	},
	variants: [
		{
			title: "一括請求",
			required: ["invoice_date"],
			properties: [{ name: "invoice_date", type: "string", format: "YYYY-MM-DD" }],
		},
		{
			title: "分割請求",
			required: ["invoice_dates"],
			properties: [{ name: "invoice_dates", type: "array", items: { type: "string" } }],
		},
	],
};

const estimatePatch: MinimalOperation = {
	summary: "見積書更新",
	requestBody: {
		properties: [
			{ name: "total", type: "string", format: "decimal" },
			{
				name: "tax_rate",
				type: "string",
				format: "decimal",
				enum: [10, 8, 5, 0],
			},
			{
				name: "details",
				type: "array",
				items: {
					type: "object",
					properties: [
						{ name: "description", type: "string" },
						{ name: "quantity", type: "number" },
						{ name: "document_detail_kbn", type: "integer", enum: [1, 2, 3], required: true },
					],
				},
			},
		],
	},
};

// 同梱スキーマの POST /v1/projects と同じ形: discriminator の enumLabels が variant title と一致する
const projectsPostWithDiscriminator: MinimalOperation = {
	summary: "案件登録",
	requestBody: {
		required: ["name", "client_id", "invoice_timing_kbn"],
		properties: [
			{ name: "name", type: "string", required: true },
			{ name: "client_id", type: "integer", required: true },
			{
				name: "invoice_timing_kbn",
				type: "integer",
				required: true,
				enum: [1, 2, 3],
				enumLabels: { "1": "一括請求", "2": "定期請求", "3": "分割請求" },
			},
		],
	},
	variants: [
		{
			title: "一括請求",
			required: ["invoice_date"],
			properties: [{ name: "invoice_date", type: "string" }],
		},
		{
			title: "定期請求",
			required: ["contract_start_date", "contract_end_date"],
			properties: [
				{ name: "contract_start_date", type: "string" },
				{ name: "contract_end_date", type: "string" },
			],
		},
		{
			title: "分割請求",
			required: ["invoice_dates"],
			properties: [{ name: "invoice_dates", type: "array", items: { type: "string" } }],
		},
	],
};

// 同じ名前のフィールドを 2 つの variant が持つ形
const sharedVariantField: MinimalOperation = {
	summary: "共有フィールド",
	requestBody: { properties: [{ name: "name", type: "string" }] },
	variants: [
		{ title: "一括請求", properties: [{ name: "invoice_date", type: "string" }] },
		{ title: "定期請求", properties: [{ name: "billing_cycle", type: "integer" }] },
		{ title: "分割請求", properties: [{ name: "billing_cycle", type: "integer" }] },
	],
};

// カスタム ID も受け付ける open enum (説明文が「…のID」を含むフィールド)
const clientsPostOpenEnum: MinimalOperation = {
	summary: "顧客登録",
	requestBody: {
		properties: [
			{
				name: "document_send_type",
				type: "integer",
				enum: [1, 2, 3, 4, 5],
				enumLabels: { "1": "メール(DL)", "5": "メール(添付)+郵送" },
				enumOpen: true,
			},
			{ name: "nda_flg", type: "integer", enum: [0, 1] },
		],
	},
};

describe("validateBody", () => {
	it("共通 required の欠落を検出する", () => {
		const r = validateBody(projectsPost, { name: "a" }, "一括請求");
		expect(r.valid).toBe(false);
		expect(r.errors.map((e) => e.path)).toEqual([
			"client_id",
			"invoice_timing_kbn",
			"invoice_date",
		]);
		expect(r.errors[0].code).toBe("required");
	});

	it("variant 指定時はその required とフィールドを検査する", () => {
		const ok = validateBody(
			projectsPost,
			{ name: "a", client_id: 1, invoice_timing_kbn: 1, invoice_date: "2026-10-31" },
			"一括請求",
		);
		expect(ok.valid).toBe(true);
		expect(ok.warnings).toEqual([]);
	});

	it("variant 未指定なら全 variant のフィールドを型検査し、variant 固有 required は warning にする", () => {
		const r = validateBody(projectsPost, { name: "a", client_id: 1, invoice_timing_kbn: 1 });
		expect(r.valid).toBe(true);
		expect(r.warnings.some((w) => w.code === "variant")).toBe(true);
		const bad = validateBody(projectsPost, {
			name: "a",
			client_id: 1,
			invoice_timing_kbn: 1,
			invoice_dates: "2026-10-31",
		});
		expect(bad.errors[0]).toMatchObject({ path: "invoice_dates", code: "type" });
	});

	it("存在しない variant はエラー", () => {
		const r = validateBody(projectsPost, {}, "月次");
		expect(r.valid).toBe(false);
		expect(r.errors[0].code).toBe("variant");
		expect(r.errors[0].message).toContain("一括請求");
	});

	it("他 variant の項目を指定すると variant エラー (unknown 警告にしない)", () => {
		const r = validateBody(
			projectsPost,
			{
				name: "a",
				client_id: 1,
				invoice_timing_kbn: 1,
				invoice_date: "2026-10-31",
				invoice_dates: ["2026-10-31"],
			},
			"一括請求",
		);
		expect(r.valid).toBe(false);
		expect(r.errors).toEqual([
			{ path: "invoice_dates", code: "variant", message: expect.any(String) },
		]);
		expect(r.errors[0].message).toContain("分割請求");
		expect(r.errors[0].message).toContain("一括請求");
		expect(r.warnings).toEqual([]);
	});

	it("enum は数値と数値文字列を同一視し、外れた値はラベル付きで報告", () => {
		const ok = validateBody(projectsPost, { name: "a", client_id: "1", invoice_timing_kbn: "2" });
		expect(ok.errors).toEqual([]);
		const bad = validateBody(projectsPost, { name: "a", client_id: 1, invoice_timing_kbn: 9 });
		expect(bad.errors[0]).toMatchObject({ path: "invoice_timing_kbn", code: "enum" });
		expect(bad.errors[0].message).toContain("1:一括");
	});

	it("enum は decimal 文字列も数値同値で比較する ('10.0' は 10 と一致) (0.3.1)", () => {
		const ok = validateBody(estimatePatch, { tax_rate: "10.0" });
		expect(ok.valid).toBe(true);
		expect(ok.errors).toEqual([]);

		const bad = validateBody(estimatePatch, { tax_rate: "7.0" });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]).toMatchObject({ path: "tax_rate", code: "enum" });
	});

	it("型不一致を検出し、number / integer は数値文字列を許容する", () => {
		// string への数値は B1 で警告扱いになったため、ここは数値以外の型不一致で確認する
		expect(
			validateBody(projectsPost, { name: true, client_id: 1, invoice_timing_kbn: 1 }).errors[0],
		).toMatchObject({
			path: "name",
			code: "type",
		});
		expect(validateBody(estimatePatch, { total: "500000.0" }).valid).toBe(true);
		expect(
			validateBody(estimatePatch, { details: [{ quantity: "1.5", document_detail_kbn: 1 }] }).valid,
		).toBe(true);
	});

	it("string 型への有限数値は error でなく warning に留める (B1)", () => {
		const r = validateBody(estimatePatch, { total: 300000 });
		expect(r.valid).toBe(true);
		expect(r.warnings.map((w) => `${w.path}:${w.code}`)).toEqual(["total:type"]);
		expect(r.warnings[0].message).toContain("string");
		expect(validateBody(estimatePatch, { total: true }).errors[0]).toMatchObject({
			path: "total",
			code: "type",
		});
	});

	it("数値の許容は format=decimal に限り、format 無しの string は従来どおり type error (B1)", () => {
		const r = validateBody(projectsPost, { name: 123, client_id: 1, invoice_timing_kbn: 1 });
		expect(r.valid).toBe(false);
		expect(r.errors[0]).toMatchObject({ path: "name", code: "type" });
	});

	it("decimal への数値は warning を積んだあとも enum 検査を続ける (B1)", () => {
		const bad = validateBody(estimatePatch, { tax_rate: 7 });
		expect(bad.valid).toBe(false);
		expect(bad.errors[0]).toMatchObject({ path: "tax_rate", code: "enum" });
		expect(bad.warnings.map((w) => `${w.path}:${w.code}`)).toEqual(["tax_rate:type"]);

		const ok = validateBody(estimatePatch, { tax_rate: 10 });
		expect(ok.valid).toBe(true);
		expect(ok.errors).toEqual([]);
		expect(ok.warnings.map((w) => `${w.path}:${w.code}`)).toEqual(["tax_rate:type"]);
	});

	it("discriminator の値が指定 variant と食い違えば variant エラー (B2)", () => {
		const r = validateBody(
			projectsPostWithDiscriminator,
			{ name: "a", client_id: 1, invoice_timing_kbn: 2, invoice_date: "2026-10-31" },
			"一括請求",
		);
		expect(r.valid).toBe(false);
		const issue = r.errors.find((e) => e.path === "invoice_timing_kbn");
		expect(issue).toMatchObject({ code: "variant" });
		expect(issue?.message).toContain("定期請求");
		expect(issue?.message).toContain("一括請求");
	});

	it("variant 未指定でも discriminator から variant を推定して検査する (B2)", () => {
		const ok = validateBody(projectsPostWithDiscriminator, {
			name: "a",
			client_id: 1,
			invoice_timing_kbn: 1,
			invoice_date: "2026-10-31",
		});
		expect(ok.valid).toBe(true);
		expect(ok.warnings.some((w) => w.message.includes("推定"))).toBe(true);

		const missing = validateBody(projectsPostWithDiscriminator, {
			name: "a",
			client_id: 1,
			invoice_timing_kbn: 2,
		});
		expect(missing.valid).toBe(false);
		expect(missing.errors.map((e) => `${e.path}:${e.code}`)).toEqual([
			"contract_start_date:required",
			"contract_end_date:required",
		]);
	});

	it("discriminator が無い / 値が未指定なら従来どおり全 variant を型検査する (B2)", () => {
		const r = validateBody(projectsPostWithDiscriminator, { name: "a", client_id: 1 });
		expect(r.warnings.some((w) => w.message.includes("variant 未指定のため"))).toBe(true);
		expect(r.errors.map((e) => e.path)).toEqual(["invoice_timing_kbn"]);
	});

	it("複数 variant に属するフィールドは全 variant 名を案内する (B4)", () => {
		const r = validateBody(sharedVariantField, { name: "a", billing_cycle: 1 }, "一括請求");
		expect(r.valid).toBe(false);
		expect(r.errors[0]).toMatchObject({ path: "billing_cycle", code: "variant" });
		expect(r.errors[0].message).toContain("定期請求");
		expect(r.errors[0].message).toContain("分割請求");
	});

	it("enumOpen のフィールドは enum 外の値を warning に留める (B3)", () => {
		const r = validateBody(clientsPostOpenEnum, { document_send_type: 99 });
		expect(r.valid).toBe(true);
		expect(r.warnings.map((w) => `${w.path}:${w.code}`)).toEqual(["document_send_type:enum"]);
		expect(r.warnings[0].message).toContain("カスタム ID");
		expect(validateBody(clientsPostOpenEnum, { document_send_type: 5 }).warnings).toEqual([]);
		expect(validateBody(clientsPostOpenEnum, { nda_flg: 9 }).errors[0]).toMatchObject({
			path: "nda_flg",
			code: "enum",
		});
	});

	it("配列 items の required / enum を要素ごとに検査する", () => {
		const r = validateBody(estimatePatch, {
			details: [
				{ description: "a", document_detail_kbn: 1 },
				{ description: "b" },
				{ document_detail_kbn: 7 },
			],
		});
		expect(r.errors.map((e) => `${e.path}:${e.code}`)).toEqual([
			"details[1].document_detail_kbn:required",
			"details[2].document_detail_kbn:enum",
		]);
	});

	it("スカラー配列の要素型を検査する", () => {
		const r = validateBody(projectsPost, {
			name: "a",
			client_id: 1,
			invoice_timing_kbn: 1,
			tags: [1, "b"],
		});
		expect(r.errors[0]).toMatchObject({ path: "tags[0]", code: "type" });
	});

	it("スキーマに無いキーは warning (拒否しない)", () => {
		const r = validateBody(estimatePatch, { total: "1", extra: 1 });
		expect(r.valid).toBe(true);
		expect(r.warnings[0]).toMatchObject({ path: "extra", code: "unknown" });
	});

	it("requestBody が無い operation は valid", () => {
		expect(validateBody({ summary: "x" }, { a: 1 }).valid).toBe(true);
	});

	it("formatBodyIssues はメッセージを ; で連結する", () => {
		const r = validateBody(projectsPost, {}, "一括請求");
		expect(formatBodyIssues(r.errors)).toContain("name は必須です");
		expect(formatBodyIssues(r.errors).split("; ").length).toBe(4);
	});
});
