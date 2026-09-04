/**
 * list_paths の検索・表示用の別名表。キーは `/v1/<prefix>` の prefix、
 * 書類系は `<prefix>/<kind>` の 2 段。英語と日本語の言い換えを持つ。
 */
const ALIASES: Record<string, string[]> = {
	clients: ["client", "customer", "顧客", "取引先"],
	client_branches: ["client", "branch", "支社", "拠点"],
	contacts: ["contact", "person", "担当者"],
	projects: ["project", "deal", "案件"],
	project_costs: ["cost", "原価"],
	invoices: ["invoice", "billing", "請求", "未入金", "入金"],
	"documents/estimates": ["document", "estimate", "quote", "見積"],
	"documents/orders": ["document", "order", "発注書", "注文"],
	"documents/deliveries": ["document", "delivery", "納品"],
	"documents/invoices": ["document", "invoice", "請求書"],
	"documents/receipts": ["document", "receipt", "領収"],
	document_send_channels: ["master", "send", "送付"],
	payees: ["payee", "vendor", "supplier", "支払先"],
	payee_branches: ["payee", "branch", "支払先"],
	payee_contacts: ["payee", "contact", "支払先", "担当者"],
	expenditures: ["expenditure", "expense", "purchase", "仕入", "発注"],
	expenditure_payments: ["expenditure", "payment", "支払", "仕入"],
	"expenditure_documents/estimates": ["expenditure", "estimate", "仕入", "見積"],
	"expenditure_documents/orders": ["expenditure", "order", "仕入", "発注書"],
	"expenditure_documents/deliveries": ["expenditure", "delivery", "仕入", "納品"],
	"expenditure_documents/invoices": ["expenditure", "invoice", "仕入", "請求書"],
	analyses: ["analysis", "sales", "revenue", "report", "monthly", "売上", "集計", "計上"],
	users: ["master", "user", "member", "ユーザ"],
	groups: ["master", "group", "部署"],
	payment_terms: ["master", "payment term", "支払条件"],
	project_types: ["master", "type", "案件種別"],
	expenditure_types: ["master", "type", "発注種別"],
	accounting_types: ["master", "type", "計上種別"],
};

/** パスの別名。2 段キー (documents/estimates 等) を優先し、無ければ prefix で引く。 */
export function aliasesForPath(path: string): string[] {
	const segments = path.split("/").filter(Boolean); // ["v1", prefix, sub, ...]
	const prefix = segments[1] ?? "";
	const two = segments[2] ? `${prefix}/${segments[2]}` : undefined;
	if (two && ALIASES[two]) return ALIASES[two];
	return ALIASES[prefix] ?? [];
}
