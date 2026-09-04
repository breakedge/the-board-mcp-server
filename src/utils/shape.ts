import type { Pagination } from "../api/client.js";

export type ResponseFormat = "concise" | "detailed";

export const DEFAULT_MAX_RESPONSE_CHARS = 20_000;

/** 応答テキストの上限文字数。THE_BOARD_MAX_RESPONSE_CHARS (正の整数) で上書き可。 */
export function maxResponseChars(): number {
	const raw = process.env.THE_BOARD_MAX_RESPONSE_CHARS;
	const n = raw === undefined || raw === "" ? Number.NaN : Number(raw);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_RESPONSE_CHARS;
}

/** fields 引数 (配列またはカンマ区切り文字列) を重複・空要素なしの配列にする。 */
export function parseFields(input: unknown): string[] | undefined {
	if (input === undefined || input === null) return undefined;
	const list = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
	const cleaned = list.map((v) => String(v).trim()).filter((v) => v.length > 0);
	return cleaned.length > 0 ? [...new Set(cleaned)] : undefined;
}

interface FieldNode {
	leaf: boolean;
	children: Map<string, FieldNode>;
}

function buildTree(fields: string[]): FieldNode {
	const root: FieldNode = { leaf: false, children: new Map() };
	for (const field of fields) {
		let node = root;
		for (const segment of field.split(".")) {
			if (!segment) continue;
			let next = node.children.get(segment);
			if (!next) {
				next = { leaf: false, children: new Map() };
				node.children.set(segment, next);
			}
			node = next;
		}
		node.leaf = true;
	}
	return root;
}

/** node 配下で要求された全パスを matched に入れる (親を丸ごと採用したとき用)。 */
function markAll(node: FieldNode, path: string, matched: Set<string>): void {
	if (node.leaf) matched.add(path);
	for (const [key, child] of node.children) markAll(child, `${path}.${key}`, matched);
}

function project(value: unknown, node: FieldNode, prefix: string, matched: Set<string>): unknown {
	if (Array.isArray(value)) return value.map((v) => project(v, node, prefix, matched));
	if (value === null || typeof value !== "object") return value;
	const source = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, child] of node.children) {
		if (!(key in source)) continue;
		const path = prefix ? `${prefix}.${key}` : key;
		const inner = source[key];
		// leaf は値を丸ごと採用。途中が null / スカラなら潜れないのでそのまま残す
		if (child.leaf || inner === null || typeof inner !== "object") {
			if (child.leaf) markAll(child, path, matched);
			out[key] = inner;
			continue;
		}
		out[key] = project(inner, child, path, matched);
	}
	return out;
}

/**
 * ドット区切りの fields で値を絞り込む。リストは各要素に、途中の配列は各要素に適用する。
 * どこにも存在しなかったパスは unknownFields に返す (エラーにはしない)。
 */
export function applyFields(
	value: unknown,
	fields: string[],
): { value: unknown; unknownFields: string[] } {
	// 空配列には照合対象のレコードが無く、どの field も「見つからなかった」とは言えない。
	// unknownFields に載せると「フィールド名が誤り」と誤誘導するため、ここでは判定しない。
	if (Array.isArray(value) && value.length === 0) {
		return { value: [], unknownFields: [] };
	}
	const matched = new Set<string>();
	const projected = project(value, buildTree(fields), "", matched);
	return { value: projected, unknownFields: fields.filter((f) => !matched.has(f)) };
}

/** 値が null のキーを再帰的に省く。空配列・0・false・"" は残す。配列要素の null は残す。 */
export function omitNulls(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(omitNulls);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
			if (v === null) continue;
			out[key] = omitNulls(v);
		}
		return out;
	}
	return value;
}

function serialize(value: unknown, format: ResponseFormat): string {
	return format === "detailed" ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

export interface PaginationInfo {
	total_count: number;
	page?: number;
	per_page?: number;
	returned_count: number;
	has_more: boolean;
	next_page?: number;
}

/**
 * X-Per-Page が無いときの has_more 判定用に per_page を補う。切り詰めがあると
 * 実返却数は 1 page 分より少なくなるため、fallback には切り詰め前の件数を渡す (C2)。
 */
export function toPaginationInfo(
	p: Pagination,
	returnedCount: number,
	fallbackPerPage: number = returnedCount,
): PaginationInfo {
	const perPage = p.perPage ?? fallbackPerPage;
	const hasMore = p.page !== undefined && p.page * perPage < p.totalCount;
	const info: PaginationInfo = {
		total_count: p.totalCount,
		...(p.page !== undefined ? { page: p.page } : {}),
		...(p.perPage !== undefined ? { per_page: p.perPage } : {}),
		returned_count: returnedCount,
		has_more: hasMore,
	};
	if (hasMore && p.page !== undefined) info.next_page = p.page + 1;
	return info;
}

export interface ListEnvelopeInput {
	data: unknown[];
	pagination?: Pagination;
	format: ResponseFormat;
	maxChars: number;
	unknownFields?: string[];
	request?: { path: string; query?: Record<string, unknown> };
}

const SINGLE_TOO_LARGE = (max: number) =>
	`応答が上限 ${max} 字を超えています。fields で必要なキーだけ指定してください。`;

/**
 * リスト応答の envelope を文字列で返す。上限超過時は末尾からレコード単位で落とす
 * (レコード途中では切らない)。1 件でも超過するときはその 1 件を丸ごと返す。
 */
export function buildListEnvelope(input: ListEnvelopeInput): string {
	const kept = [...input.data];
	let dropped = 0;

	const build = (): Record<string, unknown> => {
		// concise は data の null キーのみ省く (request の echo 値には適用しない)
		const dataOut = input.format === "concise" ? kept.map(omitNulls) : kept;
		const env: Record<string, unknown> = { data: dataOut };
		if (input.pagination) {
			env.pagination = toPaginationInfo(input.pagination, kept.length, input.data.length);
		}
		env.truncated = dropped > 0;
		if (input.unknownFields && input.unknownFields.length > 0) {
			env.unknown_fields = input.unknownFields;
		}
		if (kept.length === 0 && input.request) {
			env.request = input.request;
			env.validated = true;
		}
		if (dropped > 0) {
			env.dropped_in_page = dropped;
			// has_more は API の page 送りの意味のまま残すため、page 自体が欠けていることを別キーで示す。
			// これが無いと truncated + has_more を見た利用者が page を進め、落ちたレコードを飛ばす (C3)。
			env.page_incomplete = true;
			if (env.pagination) delete (env.pagination as PaginationInfo).next_page;
			env.notice = `応答が上限 ${input.maxChars} 字を超えたため、この page の末尾 ${dropped} 件を省略しました。この page は不完全です。fields か小さい per_page で同じ page を再取得してから next_page に進んでください。`;
		}
		return env;
	};

	let text = serialize(build(), input.format);
	while (text.length > input.maxChars && kept.length > 1) {
		kept.pop();
		dropped++;
		text = serialize(build(), input.format);
	}
	if (text.length > input.maxChars && kept.length === 1) {
		const env = build();
		// 省略件数の案内を上書きすると「何件落ちたか」が失われるため、両方を残す
		const dropNotice = typeof env.notice === "string" ? env.notice : undefined;
		env.notice = dropNotice
			? `${dropNotice} ${SINGLE_TOO_LARGE(input.maxChars)}`
			: SINGLE_TOO_LARGE(input.maxChars);
		text = serialize(env, input.format);
	}
	return text;
}

export interface SingleEnvelopeInput {
	data: unknown;
	format: ResponseFormat;
	maxChars: number;
	unknownFields?: string[];
}

/**
 * 単体応答の envelope。上限を超えたら、data のトップレベルにある配列/オブジェクト値を
 * JSON 長の大きい順に落として上限内へ収める (C4)。スカラは残すので id / name 等は必ず返る。
 * 落とせるものを全て落としても超過するときは、data を丸ごと返して notice だけ付ける。
 */
export function buildSingleEnvelope(input: SingleEnvelopeInput): string {
	const dataOut = input.format === "concise" ? omitNulls(input.data) : input.data;
	const env: Record<string, unknown> = { data: dataOut };
	if (input.unknownFields && input.unknownFields.length > 0) {
		env.unknown_fields = input.unknownFields;
	}
	let text = serialize(env, input.format);
	if (text.length <= input.maxChars) return text;

	if (dataOut !== null && typeof dataOut === "object" && !Array.isArray(dataOut)) {
		const source = dataOut as Record<string, unknown>;
		const candidates = Object.entries(source)
			.filter(([, v]) => v !== null && typeof v === "object")
			.map(([key, v]) => ({ key, chars: JSON.stringify(v)?.length ?? 0 }))
			.sort((a, b) => b.chars - a.chars);
		const omitted: { key: string; chars: number }[] = [];
		for (const candidate of candidates) {
			omitted.push(candidate);
			const omittedKeys = new Set(omitted.map((o) => o.key));
			env.data = Object.fromEntries(
				Object.entries(source).filter(([key]) => !omittedKeys.has(key)),
			);
			env.omitted_keys = omitted;
			env.notice = `大きな項目 ${omitted.map((o) => o.key).join(", ")} を省略しました。必要なら fields で指定して取得してください。`;
			text = serialize(env, input.format);
			if (text.length <= input.maxChars) return text;
		}
		// 全て落としても収まらないなら、部分的な data を返すより全文 + 案内のほうが有用
		env.data = dataOut;
		delete env.omitted_keys;
	}
	env.notice = SINGLE_TOO_LARGE(input.maxChars);
	return serialize(env, input.format);
}
