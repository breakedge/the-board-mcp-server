import { matchPathPattern } from "./schema-loader.js";
import type { MinimalSchema } from "./types.js";

/** prefix ごとの業務上の案内 (method 非対応のときに添える)。 */
const PREFIX_HINTS: Record<string, string> = {
	invoices:
		"請求書は直接作成できません。POST /v1/projects で案件を作ると board が請求書を自動生成し、PATCH /v1/documents/invoices/{id} で内容を更新します。",
	documents:
		"書類 (見積書・発注書・納品書・請求書・領収書) は案件から自動生成されます。作成は POST /v1/projects、更新は PATCH /v1/documents/<kind>/{id}、書類 id は GET /v1/projects/{id}?response_group=all で確認してください。",
	analyses: "計上データは読み取り専用です。",
};

const MAX_CANDIDATES = 5;

function prefixOf(path: string): string {
	return path.split("/").filter(Boolean)[1] ?? "";
}

/** 2 文字列の共通接頭辞の長さ。候補を「入力パスに近い順」に並べるためのスコア。 */
function sharedPrefixLength(a: string, b: string): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i;
}

/**
 * パス未検出時のメッセージ。パスはあるが method 非対応なら対応 method と業務上の案内、
 * パス自体が無ければ同じ prefix の候補 (最大 5 件) か list_paths の案内を返す。
 */
export function formatPathNotFound(method: string, path: string, schema: MinimalSchema): string {
	const upper = method.toUpperCase();
	const pattern = matchPathPattern(path, schema);
	if (pattern) {
		const supported = Object.keys(schema.paths[pattern]).join(", ");
		const hint = PREFIX_HINTS[prefixOf(pattern)];
		return `${pattern} は ${upper} に対応していません (対応 method: ${supported})。${hint ? ` ${hint}` : ""}`;
	}
	const prefix = prefixOf(path);
	const candidates = Object.keys(schema.paths)
		.filter((p) => prefix.length > 0 && prefixOf(p) === prefix)
		.sort((a, b) => sharedPrefixLength(path, b) - sharedPrefixLength(path, a))
		.slice(0, MAX_CANDIDATES);
	if (candidates.length > 0) {
		return `パスが見つかりません: ${path}。近いパス: ${candidates.join(", ")}`;
	}
	return `パスが見つかりません: ${path}。the_board_api_list_paths で正しいパスを確認してください。`;
}
