import type { MinimalParameter } from "./types.js";

const DATE_PARAM = /_date(_gteq|_lteq|_eq)?$/;
const YM_PARAM = /^report_ym(_gteq|_lteq)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YM_RE = /^\d{4}-\d{2}$/;

function isIntegerLike(v: unknown): boolean {
	if (typeof v === "number") return Number.isInteger(v);
	return typeof v === "string" && /^-?\d+$/.test(v.trim());
}

function enumText(p: MinimalParameter): string {
	return (p.enum ?? [])
		.map((v) => {
			const label = p.enumLabels?.[String(v)];
			return label ? `${v}:${label}` : String(v);
		})
		.join(", ");
}

/**
 * query の値を型・enum・日付形式・範囲で検証する。問題があればメッセージ、無ければ null。
 * スキーマに無いキー、null / undefined の値は検査しない (キーの検証は validateQuery が担う)。
 */
export function validateQueryValues(
	query: Record<string, unknown>,
	params: MinimalParameter[],
): string | null {
	const byName = new Map(params.map((p) => [p.name, p]));
	for (const [key, raw] of Object.entries(query)) {
		const p = byName.get(key);
		if (!p || raw === null || raw === undefined) continue;
		const values = Array.isArray(raw) ? raw : [raw];
		for (const v of values) {
			if (p.type === "integer" && !isIntegerLike(v)) {
				return `クエリパラメータ "${key}" は整数で指定してください (受け取った値: ${JSON.stringify(v)})`;
			}
			if (p.enum && p.enum.length > 0 && !p.enum.some((e) => String(e) === String(v))) {
				return `クエリパラメータ "${key}" の値 ${JSON.stringify(v)} は指定できません。有効な値: ${enumText(p)}`;
			}
			if (typeof v === "string") {
				if (YM_PARAM.test(key) && !YM_RE.test(v)) {
					return `クエリパラメータ "${key}" は YYYY-MM 形式で指定してください (例 2026-08)`;
				}
				if (!YM_PARAM.test(key) && DATE_PARAM.test(key) && !DATE_RE.test(v)) {
					return `クエリパラメータ "${key}" は YYYY-MM-DD 形式で指定してください (例 2026-08-31)`;
				}
			}
		}
		if (key === "per_page") {
			const n = Number(raw);
			if (!(Number.isInteger(n) && n >= 1 && n <= 100)) {
				return `per_page は 1 から 100 の整数で指定してください (受け取った値: ${JSON.stringify(raw)})`;
			}
		}
		if (key === "page") {
			const n = Number(raw);
			if (!(Number.isInteger(n) && n >= 1)) {
				return `page は 1 以上の整数で指定してください (受け取った値: ${JSON.stringify(raw)})`;
			}
		}
	}
	return null;
}
