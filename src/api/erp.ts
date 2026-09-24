/**
 * ERPNext accounting calls, all scoped to the one configured company.
 *
 * Permissions are the signed-in user's own: nothing here elevates, so a user sees and
 * creates exactly what their ERPNext roles allow.
 */
import { call, getDoc, getList } from "./client";
import type { OpenInvoice } from "../lib/aging";
import type { AccountInfo } from "../lib/journal";
import type { OpenReference, PaymentType } from "../lib/payment";
import { parseLedger, type Ledger } from "../lib/ledger";
import type { InvoiceKind, TaxRow } from "../lib/invoice";
import { INVOICE_DOCTYPE, PARTY_TYPE } from "../lib/invoice";

export interface Company {
	name: string;
	company_name: string;
	abbr: string;
	default_currency: string;
	cost_center?: string | null;
}

export async function getCompany(name: string): Promise<Company | null> {
	const rows = await getList<Company>("Company", {
		fields: ["name", "company_name", "abbr", "default_currency", "cost_center"],
		filters: [["name", "=", name]],
		limit: 1,
	});
	return rows[0] ?? null;
}

export async function listCompanies(): Promise<string[]> {
	return (await getList<{ name: string }>("Company", { fields: ["name"], limit: 50 })).map((row) => row.name);
}

export async function getFullName(user: string): Promise<string> {
	try {
		const rows = await getList<{ full_name: string }>("User", {
			fields: ["full_name"],
			filters: [["name", "=", user]],
			limit: 1,
		});
		return rows[0]?.full_name || user;
	} catch {
		return user;
	}
}

// --- receivable / payable -------------------------------------------------------

/** The most open invoices fetched in one go. Past this the screen says it is partial. */
export const OUTSTANDING_LIMIT = 1000;

export async function listOutstanding(kind: InvoiceKind, company: string, party?: string): Promise<OpenInvoice[]> {
	const doctype = INVOICE_DOCTYPE[kind];
	const partyField = kind === "sales" ? "customer" : "supplier";
	const nameField = kind === "sales" ? "customer_name" : "supplier_name";

	const filters: unknown[] = [
		["docstatus", "=", 1],
		["company", "=", company],
		["outstanding_amount", "!=", 0],
	];
	if (party) filters.push([partyField, "=", party]);

	const rows = await getList<Record<string, unknown>>(doctype, {
		fields: [
			"name",
			partyField,
			nameField,
			"posting_date",
			"due_date",
			"grand_total",
			"outstanding_amount",
			"currency",
			"status",
		],
		filters,
		orderBy: "due_date asc, name asc",
		limit: OUTSTANDING_LIMIT,
	});

	return rows.map((row) => ({
		name: String(row.name),
		party: String(row[partyField] ?? ""),
		party_name: String(row[nameField] ?? row[partyField] ?? ""),
		posting_date: String(row.posting_date ?? ""),
		due_date: (row.due_date as string) ?? null,
		grand_total: Number(row.grand_total ?? 0),
		outstanding_amount: Number(row.outstanding_amount ?? 0),
		currency: row.currency as string | undefined,
		status: row.status as string | undefined,
	}));
}

export async function openReferences(paymentType: PaymentType, company: string, party: string): Promise<OpenReference[]> {
	const kind: InvoiceKind = paymentType === "Receive" ? "sales" : "purchase";
	const doctype = INVOICE_DOCTYPE[kind];
	return (await listOutstanding(kind, company, party)).map((invoice) => ({
		doctype,
		name: invoice.name,
		due_date: invoice.due_date,
		posting_date: invoice.posting_date,
		outstanding_amount: invoice.outstanding_amount,
	}));
}

// --- ledgers ---------------------------------------------------------------------

export interface LedgerQuery {
	company: string;
	from_date: string;
	to_date: string;
	account?: string;
	party_type?: string;
	party?: string;
}

export async function getLedger(query: LedgerQuery): Promise<Ledger> {
	const filters: Record<string, unknown> = {
		company: query.company,
		from_date: query.from_date,
		to_date: query.to_date,
		categorize_by: "Categorize by Voucher (Consolidated)",
	};
	if (query.account) filters.account = [query.account];
	if (query.party_type && query.party) {
		filters.party_type = query.party_type;
		filters.party = [query.party];
	}

	const response = await call<{ result?: unknown; prepared_report?: boolean }>("frappe.desk.query_report.run", {
		report_name: "General Ledger",
		filters,
		ignore_prepared_report: true,
	});
	return parseLedger(response?.result);
}

// --- masters ---------------------------------------------------------------------

export interface LinkOption {
	value: string;
	description?: string;
	label?: string;
}

export async function searchLink(doctype: string, txt: string, filters?: unknown): Promise<LinkOption[]> {
	const results = await call<LinkOption[]>("frappe.desk.search.search_link", {
		doctype,
		txt,
		filters: filters ?? undefined,
		page_length: 20,
	});
	return results ?? [];
}

/** The leaf accounts of the company, in one request. Charts are small enough to hold. */
export async function listAccounts(company: string): Promise<AccountInfo[]> {
	return getList<AccountInfo>("Account", {
		fields: ["name", "account_name", "account_type", "account_currency", "root_type"],
		filters: [
			["company", "=", company],
			["is_group", "=", 0],
			["disabled", "=", 0],
		],
		orderBy: "name asc",
		limit: 0,
	});
}

export async function listModesOfPayment(): Promise<string[]> {
	return (
		await getList<{ name: string }>("Mode of Payment", {
			fields: ["name"],
			filters: [["enabled", "=", 1]],
			orderBy: "name asc",
			limit: 100,
		})
	).map((row) => row.name);
}

/** The cash or bank account a mode of payment posts to for this company. */
export async function bankAccountFor(modeOfPayment: string, company: string): Promise<string> {
	const result = await call<{ account: string }>("erpnext.accounts.doctype.sales_invoice.sales_invoice.get_bank_cash_account", {
		mode_of_payment: modeOfPayment,
		company,
	});
	return result.account;
}

export interface PartyDetails {
	party_account: string;
	party_name: string;
	party_account_currency: string;
}

export async function partyDetails(company: string, partyType: string, party: string, date: string): Promise<PartyDetails> {
	return call<PartyDetails>("erpnext.accounts.doctype.payment_entry.payment_entry.get_party_details", {
		company,
		party_type: partyType,
		party,
		date,
	});
}

/** ERPNext's own Payment Entry for an invoice, unsaved. */
export async function paymentEntryFor(doctype: string, name: string): Promise<Record<string, unknown>> {
	return call<Record<string, unknown>>("erpnext.accounts.doctype.payment_entry.payment_entry.get_payment_entry", {
		dt: doctype,
		dn: name,
	});
}

export async function taxRows(templateDoctype: string, template: string): Promise<TaxRow[]> {
	const rows = await call<TaxRow[] | null>("erpnext.controllers.accounts_controller.get_taxes_and_charges", {
		master_doctype: templateDoctype,
		master_name: template,
	});
	return rows ?? [];
}

/** A starting rate for an item: its price on the standard list, else any list. */
export async function itemRate(itemCode: string, kind: InvoiceKind): Promise<number | null> {
	const side = kind === "sales" ? "selling" : "buying";
	const preferred = kind === "sales" ? "Standard Selling" : "Standard Buying";
	const prices = await getList<{ price_list: string; price_list_rate: number }>("Item Price", {
		fields: ["price_list", "price_list_rate"],
		filters: [
			["item_code", "=", itemCode],
			[side, "=", 1],
		],
		orderBy: "modified desc",
		limit: 10,
	});
	const price = prices.find((row) => row.price_list === preferred) ?? prices[0];
	return price ? Number(price.price_list_rate) : null;
}

export { PARTY_TYPE };

// --- documents ---------------------------------------------------------------------

export const DOC_TYPES = ["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface DocSummary {
	name: string;
	docstatus: number;
	status?: string;
	date: string;
	title: string;
	amount: number;
	outstanding?: number;
}

const SUMMARY_FIELDS: Record<DocType, { fields: string[]; map: (row: Record<string, unknown>) => DocSummary }> = {
	"Sales Invoice": {
		fields: ["name", "docstatus", "status", "posting_date", "customer_name", "grand_total", "outstanding_amount"],
		map: (row) => ({
			name: String(row.name),
			docstatus: Number(row.docstatus),
			status: row.status as string,
			date: String(row.posting_date),
			title: String(row.customer_name ?? ""),
			amount: Number(row.grand_total ?? 0),
			outstanding: Number(row.outstanding_amount ?? 0),
		}),
	},
	"Purchase Invoice": {
		fields: ["name", "docstatus", "status", "posting_date", "supplier_name", "grand_total", "outstanding_amount"],
		map: (row) => ({
			name: String(row.name),
			docstatus: Number(row.docstatus),
			status: row.status as string,
			date: String(row.posting_date),
			title: String(row.supplier_name ?? ""),
			amount: Number(row.grand_total ?? 0),
			outstanding: Number(row.outstanding_amount ?? 0),
		}),
	},
	"Payment Entry": {
		fields: ["name", "docstatus", "status", "posting_date", "payment_type", "party_name", "paid_amount"],
		map: (row) => ({
			name: String(row.name),
			docstatus: Number(row.docstatus),
			status: row.status as string,
			date: String(row.posting_date),
			title: `${row.payment_type ?? ""} · ${row.party_name ?? ""}`,
			amount: Number(row.paid_amount ?? 0),
		}),
	},
	"Journal Entry": {
		fields: ["name", "docstatus", "posting_date", "voucher_type", "title", "total_debit"],
		map: (row) => ({
			name: String(row.name),
			docstatus: Number(row.docstatus),
			status: ["Draft", "Submitted", "Cancelled"][Number(row.docstatus)] ?? "",
			date: String(row.posting_date),
			title: `${row.voucher_type ?? ""} · ${row.title ?? ""}`,
			amount: Number(row.total_debit ?? 0),
		}),
	},
};

export async function recentDocs(doctype: DocType, company: string, search = ""): Promise<DocSummary[]> {
	const spec = SUMMARY_FIELDS[doctype];
	const filters: unknown[] = [["company", "=", company]];
	const orFilters: unknown[] = [];
	if (search.trim()) {
		const like = `%${search.trim()}%`;
		orFilters.push(["name", "like", like]);
		if (doctype === "Sales Invoice") orFilters.push(["customer_name", "like", like]);
		if (doctype === "Purchase Invoice") orFilters.push(["supplier_name", "like", like]);
		if (doctype === "Payment Entry") orFilters.push(["party_name", "like", like]);
		if (doctype === "Journal Entry") orFilters.push(["title", "like", like]);
	}

	const rows = await getList<Record<string, unknown>>(doctype, {
		fields: spec.fields,
		filters,
		orFilters,
		orderBy: "creation desc",
		limit: 40,
	});
	return rows.map(spec.map);
}

export async function loadDoc(doctype: string, name: string): Promise<Record<string, unknown>> {
	return getDoc(doctype, name);
}
