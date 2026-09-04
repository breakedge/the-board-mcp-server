import type { MinimalField, MinimalOperation } from "./types.js";

export interface BodyIssue {
	path: string;
	code: "required" | "enum" | "type" | "unknown" | "variant";
	message: string;
}

export interface BodyValidation {
	valid: boolean;
	errors: BodyIssue[];
	warnings: BodyIssue[];
}

const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
const INTEGER_STRING = /^-?\d+$/;

/** board は金額を decimal 文字列で扱うため、number / integer は数値文字列も受け付ける。 */
function typeMatches(type: string | undefined, value: unknown): boolean {
	switch (type) {
		case "string":
			return typeof value === "string";
		case "integer":
			return (
				(typeof value === "number" && Number.isInteger(value)) ||
				(typeof value === "string" && INTEGER_STRING.test(value))
			);
		case "number":
			return typeof value === "number" || (typeof value === "string" && NUMERIC_STRING.test(value));
		case "boolean":
			return typeof value === "boolean";
		case "array":
			return Array.isArray(value);
		case "object":
			return value !== null && typeof value === "object" && !Array.isArray(value);
		default:
			return true;
	}
}

function enumText(field: MinimalField): string {
	return (field.enum ?? [])
		.map((v) => {
			const label = field.enumLabels?.[String(v)];
			return label ? `${v}:${label}` : String(v);
		})
		.join(", ");
}

function join(prefix: string, key: string): string {
	return prefix ? `${prefix}.${key}` : key;
}

function checkField(
	field: MinimalField,
	value: unknown,
	path: string,
	errors: BodyIssue[],
	warnings: BodyIssue[],
): void {
	if (value === null || value === undefined) return;
	if (!typeMatches(field.type, value)) {
		errors.push({
			path,
			code: "type",
			message: `${path} は ${field.type} で指定してください (受け取った値: ${JSON.stringify(value)})`,
		});
		return;
	}
	if (field.enum && field.enum.length > 0 && !field.enum.some((e) => String(e) === String(value))) {
		errors.push({
			path,
			code: "enum",
			message: `${path} の値 ${JSON.stringify(value)} は指定できません。有効な値: ${enumText(field)}`,
		});
		return;
	}
	if (field.type === "array" && Array.isArray(value) && field.items?.properties) {
		const itemFields = field.items.properties;
		value.forEach((item, i) => {
			checkObject(itemFields, undefined, item, `${path}[${i}]`, errors, warnings);
		});
	} else if (field.type === "object" && field.properties) {
		checkObject(field.properties, undefined, value, path, errors, warnings);
	}
}

/**
 * オブジェクトを fields で検査する。required は明示配列があればそれ、無ければ各 field の required フラグ。
 */
function checkObject(
	fields: MinimalField[],
	required: string[] | undefined,
	value: unknown,
	prefix: string,
	errors: BodyIssue[],
	warnings: BodyIssue[],
): void {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		errors.push({
			path: prefix || "(body)",
			code: "type",
			message: `${prefix || "body"} はオブジェクトで指定してください`,
		});
		return;
	}
	const obj = value as Record<string, unknown>;
	const byName = new Map(fields.map((f) => [f.name, f]));
	const requiredNames = required ?? fields.filter((f) => f.required).map((f) => f.name);
	for (const name of requiredNames) {
		if (obj[name] === undefined || obj[name] === null) {
			errors.push({
				path: join(prefix, name),
				code: "required",
				message: `${join(prefix, name)} は必須です`,
			});
		}
	}
	for (const [key, v] of Object.entries(obj)) {
		const field = byName.get(key);
		if (!field) {
			warnings.push({
				path: join(prefix, key),
				code: "unknown",
				message: `${join(prefix, key)} は同梱スキーマに無い項目です (spec が古い可能性あり。送信はされます)`,
			});
			continue;
		}
		checkField(field, v, join(prefix, key), errors, warnings);
	}
}

/**
 * requestBody に対して body を検証する。variant を持つ operation では、指定があればその分岐の
 * required とフィールドも検査し、未指定なら全分岐のフィールドを型検査だけして warning を出す。
 */
export function validateBody(
	op: MinimalOperation,
	body: Record<string, unknown>,
	variant?: string,
): BodyValidation {
	const errors: BodyIssue[] = [];
	const warnings: BodyIssue[] = [];
	if (!op.requestBody) return { valid: true, errors, warnings };

	const fields: MinimalField[] = [...op.requestBody.properties];
	const required: string[] = [...(op.requestBody.required ?? [])];
	if (op.variants && op.variants.length > 0) {
		const titles = op.variants.map((v) => v.title).join(", ");
		if (variant) {
			const found = op.variants.find((v) => v.title === variant);
			if (!found) {
				errors.push({
					path: "variant",
					code: "variant",
					message: `variant "${variant}" はありません。指定できる variant: ${titles}`,
				});
				return { valid: false, errors, warnings };
			}
			fields.push(...found.properties);
			required.push(...(found.required ?? []));
		} else {
			for (const v of op.variants) fields.push(...v.properties);
			warnings.push({
				path: "variant",
				code: "variant",
				message: `variant 未指定のため請求方式固有の必須項目は未検査です。指定できる variant: ${titles}`,
			});
		}
	}
	checkObject(fields, required, body, "", errors, warnings);
	return { valid: errors.length === 0, errors, warnings };
}

export function formatBodyIssues(issues: BodyIssue[]): string {
	return issues.map((i) => i.message).join("; ");
}
