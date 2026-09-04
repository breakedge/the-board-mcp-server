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

	it("enum は数値と数値文字列を同一視し、外れた値はラベル付きで報告", () => {
		const ok = validateBody(projectsPost, { name: "a", client_id: "1", invoice_timing_kbn: "2" });
		expect(ok.errors).toEqual([]);
		const bad = validateBody(projectsPost, { name: "a", client_id: 1, invoice_timing_kbn: 9 });
		expect(bad.errors[0]).toMatchObject({ path: "invoice_timing_kbn", code: "enum" });
		expect(bad.errors[0].message).toContain("1:一括");
	});

	it("型不一致を検出し、number / integer は数値文字列を許容する", () => {
		expect(
			validateBody(projectsPost, { name: 1, client_id: 1, invoice_timing_kbn: 1 }).errors[0],
		).toMatchObject({
			path: "name",
			code: "type",
		});
		expect(validateBody(estimatePatch, { total: "500000.0" }).valid).toBe(true);
		expect(
			validateBody(estimatePatch, { details: [{ quantity: "1.5", document_detail_kbn: 1 }] }).valid,
		).toBe(true);
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
