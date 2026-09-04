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
		// 公式スキーマは total / tax / tax_rate / unit_price を string(decimal) と定義するが、LLM は
		// 数値を出しがちで board 側も数値を解釈する。送信前に止めず警告に留める (B1)。
		// 例外は decimal に限る。format 無しの string (name 等) への数値は従来どおり error。
		// また警告のあとも return せず、enum など残りの検査を続ける。
		if (
			field.type === "string" &&
			field.format === "decimal" &&
			typeof value === "number" &&
			Number.isFinite(value)
		) {
			warnings.push({
				path,
				code: "type",
				message: `${path} はスキーマ上 string です。数値のまま送信します (問題があれば "300000" のように文字列で指定してください)`,
			});
		} else {
			errors.push({
				path,
				code: "type",
				message: `${path} は ${field.type} で指定してください (受け取った値: ${JSON.stringify(value)})`,
			});
			return;
		}
	}
	if (field.enum && field.enum.length > 0 && !field.enum.some((e) => String(e) === String(value))) {
		// enumOpen は「既知の値の列挙」でしかない enum (カスタム ID も受け付ける)。拒否せず注意喚起に留める (B3)。
		if (field.enumOpen) {
			warnings.push({
				path,
				code: "enum",
				message: `${path} の値 ${JSON.stringify(value)} は同梱スキーマの enum にありません。既知の値: ${enumText(field)} / カスタム ID も可 (そのまま送信します)`,
			});
		} else {
			errors.push({
				path,
				code: "enum",
				message: `${path} の値 ${JSON.stringify(value)} は指定できません。有効な値: ${enumText(field)}`,
			});
			return;
		}
	}
	if (field.type === "array" && Array.isArray(value) && field.items?.properties) {
		const itemFields = field.items.properties;
		value.forEach((item, i) => {
			checkObject(itemFields, undefined, item, `${path}[${i}]`, errors, warnings);
		});
	} else if (field.type === "array" && Array.isArray(value) && field.items?.type) {
		const itemType = field.items.type;
		value.forEach((item, i) => {
			if (!typeMatches(itemType, item)) {
				errors.push({
					path: `${path}[${i}]`,
					code: "type",
					message: `${path}[${i}] は ${itemType} で指定してください (受け取った値: ${JSON.stringify(item)})`,
				});
			}
		});
	} else if (field.type === "object" && field.properties) {
		checkObject(field.properties, undefined, value, path, errors, warnings);
	}
}

/**
 * オブジェクトを fields で検査する。required は明示配列があればそれ、無ければ各 field の required フラグ。
 * otherVariantOf / variantTitle はトップレベル (prefix === "") でのみ使い、指定 variant 外のキーを variant エラーにする。
 */
function checkObject(
	fields: MinimalField[],
	required: string[] | undefined,
	value: unknown,
	prefix: string,
	errors: BodyIssue[],
	warnings: BodyIssue[],
	otherVariantOf?: Map<string, string[]>,
	variantTitle?: string,
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
			const otherTitles = otherVariantOf?.get(key);
			if (otherTitles && otherTitles.length > 0) {
				// 同名フィールドを複数 variant が持つことがあるため全て挙げる (B4)
				const titles = otherTitles.map((t) => `"${t}"`).join(" / ");
				errors.push({
					path: join(prefix, key),
					code: "variant",
					message: `${join(prefix, key)} は variant ${titles} の項目で、variant "${variantTitle}" では指定できません`,
				});
				continue;
			}
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
 * variant を選ぶ discriminator フィールドを共通 properties から探す (B2)。
 * 同梱スキーマでは discriminator の enumLabels が variant title と一致する
 * (invoice_timing_kbn / payment_timing_kbn)。フィールド名を決め打ちせず、
 * 「enumLabels の値集合が全 variant title を含む」ことで一般に判定する。
 */
function findDiscriminator(
	commonFields: MinimalField[],
	variantTitles: string[],
): MinimalField | undefined {
	return commonFields.find((f) => {
		if (!f.enumLabels) return false;
		const labels = new Set(Object.values(f.enumLabels));
		return variantTitles.every((t) => labels.has(t));
	});
}

/**
 * requestBody に対して body を検証する。variant を持つ operation では、指定があればその分岐の
 * required とフィールドも検査し、未指定なら discriminator から variant を推定する。
 * discriminator も無ければ全分岐のフィールドを型検査だけして warning を出す。
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
	let otherVariantOf: Map<string, string[]> | undefined;
	let effectiveVariant = variant;
	if (op.variants && op.variants.length > 0) {
		const variantTitles = op.variants.map((v) => v.title);
		const titles = variantTitles.join(", ");
		if (variant && !op.variants.some((v) => v.title === variant)) {
			errors.push({
				path: "variant",
				code: "variant",
				message: `variant "${variant}" はありません。指定できる variant: ${titles}`,
			});
			return { valid: false, errors, warnings };
		}

		const discriminator = findDiscriminator(op.requestBody.properties, variantTitles);
		const discValue = discriminator ? body[discriminator.name] : undefined;
		const discLabel =
			discriminator && discValue !== undefined && discValue !== null
				? discriminator.enumLabels?.[String(discValue)]
				: undefined;

		if (variant) {
			// 指定 variant と body の discriminator が食い違うと board 側で別分岐として扱われ、
			// 検査した required と実際に必要な項目がずれる。送信前に止める (B2)。
			if (discriminator && discLabel && discLabel !== variant) {
				errors.push({
					path: discriminator.name,
					code: "variant",
					message: `${discriminator.name}=${String(discValue)} (${discLabel}) は variant "${variant}" と一致しません`,
				});
			}
		} else if (discLabel && variantTitles.includes(discLabel) && discriminator) {
			effectiveVariant = discLabel;
			warnings.push({
				path: "variant",
				code: "variant",
				message: `variant 未指定ですが ${discriminator.name}=${String(discValue)} から variant を "${discLabel}" と推定して検査しました`,
			});
		}

		if (effectiveVariant) {
			const selected = effectiveVariant;
			const found = op.variants.find((v) => v.title === selected);
			if (found) {
				fields.push(...found.properties);
				required.push(...(found.required ?? []));
			}
			otherVariantOf = new Map();
			for (const v of op.variants) {
				if (v.title === selected) continue;
				for (const f of v.properties) {
					const owners = otherVariantOf.get(f.name) ?? [];
					owners.push(v.title);
					otherVariantOf.set(f.name, owners);
				}
			}
		} else {
			for (const v of op.variants) fields.push(...v.properties);
			warnings.push({
				path: "variant",
				code: "variant",
				message: `variant 未指定のため請求方式固有の必須項目は未検査です。指定できる variant: ${titles}`,
			});
		}
	}
	checkObject(fields, required, body, "", errors, warnings, otherVariantOf, effectiveVariant);
	return { valid: errors.length === 0, errors, warnings };
}

export function formatBodyIssues(issues: BodyIssue[]): string {
	return issues.map((i) => i.message).join("; ");
}
