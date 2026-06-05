import type { Toolset } from "../config.js";

/**
 * API パス prefix (2 番目のセグメント `/v1/<prefix>/...`) → toolset の対応表。
 *
 * ⚠️ 境界が曖昧でドメイン確認が必要な割り当て (要レビュー):
 *  - project_costs → projects     (案件原価。expenditures 側ではなく projects とした)
 *  - expenditure_documents → expenditures (仕入側書類。売上側 documents とは別ドメインとした)
 *  - document_send_channels → documents (書類送付チャネル設定。master 寄りだが documents に含めた)
 *  - expenditure_types → master   (型マスタ。project_types/accounting_types と揃え master とした)
 *  - contacts → customers         (顧客側の連絡先)
 *  - invoices (トップレベル) → documents (売上書類扱い。/v1/documents/invoices とは別パス)
 */
const PREFIX_TOOLSET: Record<string, Toolset> = {
	projects: "projects",
	project_costs: "projects",
	project_types: "master",
	clients: "customers",
	client_branches: "customers",
	contacts: "customers",
	documents: "documents",
	invoices: "documents",
	document_send_channels: "documents",
	payees: "payees",
	payee_contacts: "payees",
	payee_branches: "payees",
	expenditures: "expenditures",
	expenditure_payments: "expenditures",
	expenditure_documents: "expenditures",
	expenditure_types: "master",
	payment_terms: "master",
	groups: "master",
	users: "master",
	accounting_types: "master",
	analyses: "analytics",
};

/**
 * パスが属する toolset を返す。`/v1/<prefix>/...` の prefix で判定。
 * 対応表にない prefix は null (toolset 制御の対象外)。
 */
export function pathToToolset(path: string): Toolset | null {
	const segments = path.split("/").filter(Boolean); // ["v1", "<prefix>", ...]
	const prefix = segments[1];
	if (!prefix) {
		return null;
	}
	return PREFIX_TOOLSET[prefix] ?? null;
}

/**
 * パスが有効な toolset 集合に含まれるか。
 * マップ外パスは fail-open で true (パス自体の検証は validatePath が担う)。
 */
export function isPathEnabled(path: string, toolsets: Toolset[]): boolean {
	const ts = pathToToolset(path);
	if (ts === null) {
		return true;
	}
	return toolsets.includes(ts);
}
