/**
 * Sales / Purchase Invoice drafting.
 *
 * Only what the operator chooses is sent: party, dates, items, quantities, rates, and an
 * optional tax template. ERPNext fills the receivable/payable account, income/expense
 * accounts, currency and totals when the invoice is saved.
 */
import { num, round2 } from "./format";

export type InvoiceKind = "sales" | "purchase";

export const INVOICE_DOCTYPE: Record<InvoiceKind, "Sales Invoice" | "Purchase Invoice"> = {
	sales: "Sales Invoice",
	purchase: "Purchase Invoice",
};

export const PARTY_TYPE: Record<InvoiceKind, "Customer" | "Supplier"> = {
	sales: "Customer",
	purchase: "Supplier",
};

export const TAX_TEMPLATE_DOCTYPE: Record<InvoiceKind, string> = {
	sales: "Sales Taxes and Charges Template",
	purchase: "Purchase Taxes and Charges Template",
};

export interface InvoiceLine {
	item_code: string;
	item_name?: string;
	qty: number | string;
	rate: number | string;
}

export interface TaxRow {
	charge_type: string;
	account_head: string;
	description?: string;
	rate?: number;
	tax_amount?: number;
	[key: string]: unknown;
}

export interface InvoiceDraft {
	kind: InvoiceKind;
	company: string;
	party: string;
	posting_date: string;
	due_date?: string;
	bill_no?: string;
	bill_date?: string;
	remarks?: string;
	taxes_and_charges: string;
	taxes: TaxRow[];
	lines: InvoiceLine[];
}

export function lineAmount(line: InvoiceLine): number {
	return round2(num(line.qty) * num(line.rate));
}

export function netTotal(lines: InvoiceLine[]): number {
	return round2(lines.reduce((sum, line) => sum + lineAmount(line), 0));
}

/**
 * A preview of the tax the template will add.
 *
 * Handles the two charge types almost every template uses. Anything else makes the
 * preview `approximate`, and the screen says the final figure comes from ERPNext.
 */
export function estimateTaxes(net: number, taxes: TaxRow[]): { amount: number; approximate: boolean } {
	let amount = 0;
	let approximate = false;

	for (const tax of taxes) {
		if (tax.charge_type === "On Net Total") amount += (net * num(tax.rate)) / 100;
		else if (tax.charge_type === "Actual") amount += num(tax.tax_amount);
		else approximate = true;
	}

	return { amount: round2(amount), approximate };
}

export function checkInvoice(draft: InvoiceDraft): string[] {
	const errors: string[] = [];
	if (!draft.party) errors.push(`Choose a ${PARTY_TYPE[draft.kind].toLowerCase()}.`);
	if (!draft.posting_date) errors.push("Choose a posting date.");
	if (draft.due_date && draft.due_date < draft.posting_date) errors.push("The due date cannot be before the posting date.");

	const lines = draft.lines.filter((line) => line.item_code);
	if (!lines.length) errors.push("Add at least one item.");
	lines.forEach((line, index) => {
		if (num(line.qty) <= 0) errors.push(`Item ${index + 1}: quantity must be more than zero.`);
		if (num(line.rate) < 0) errors.push(`Item ${index + 1}: rate cannot be negative.`);
	});

	return errors;
}

export function buildInvoice(draft: InvoiceDraft, submit: boolean): Record<string, unknown> {
	const doctype = INVOICE_DOCTYPE[draft.kind];
	const partyField = draft.kind === "sales" ? "customer" : "supplier";

	const doc: Record<string, unknown> = {
		doctype,
		docstatus: submit ? 1 : 0,
		company: draft.company,
		[partyField]: draft.party,
		// Without this ERPNext resets the posting date to today on save.
		set_posting_time: 1,
		posting_date: draft.posting_date,
		due_date: draft.due_date || undefined,
		remarks: draft.remarks || undefined,
		items: draft.lines
			.filter((line) => line.item_code)
			.map((line) => ({ item_code: line.item_code, qty: num(line.qty), rate: num(line.rate) })),
	};

	if (draft.kind === "purchase") {
		doc.bill_no = draft.bill_no || undefined;
		doc.bill_date = draft.bill_date || undefined;
	}

	if (draft.taxes_and_charges) {
		doc.taxes_and_charges = draft.taxes_and_charges;
		doc.taxes = draft.taxes.map((tax) => ({ ...tax }));
	}

	return doc;
}
