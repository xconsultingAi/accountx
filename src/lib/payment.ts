/**
 * Payment Entry assembly.
 *
 * Two ways in:
 *  - against a specific invoice: ERPNext's own `get_payment_entry` builds the document,
 *    and this module only adjusts amount, mode of payment and references;
 *  - on account for a party: built here, optionally allocated to the party's oldest open
 *    invoices first.
 *
 * The server fills everything derivable (party name, account currencies, exchange rates,
 * reference totals) on validate, so the payload carries only what the operator decided.
 */
import { num, round2 } from "./format";

export type PaymentType = "Receive" | "Pay";

export interface OpenReference {
	doctype: "Sales Invoice" | "Purchase Invoice";
	name: string;
	due_date: string | null;
	posting_date: string;
	outstanding_amount: number;
}

export interface Allocation {
	reference_doctype: string;
	reference_name: string;
	allocated_amount: number;
}

/** Oldest due first, never more than an invoice's outstanding, never more than paid. */
export function allocateOldestFirst(invoices: OpenReference[], amount: number): Allocation[] {
	let remaining = round2(amount);
	const allocations: Allocation[] = [];

	const ordered = [...invoices]
		.filter((invoice) => num(invoice.outstanding_amount) > 0)
		.sort((a, b) =>
			(a.due_date || a.posting_date).localeCompare(b.due_date || b.posting_date) || a.name.localeCompare(b.name)
		);

	for (const invoice of ordered) {
		if (remaining <= 0) break;
		const allocated = round2(Math.min(remaining, num(invoice.outstanding_amount)));
		allocations.push({ reference_doctype: invoice.doctype, reference_name: invoice.name, allocated_amount: allocated });
		remaining = round2(remaining - allocated);
	}

	return allocations;
}

export interface OnAccountPayment {
	company: string;
	payment_type: PaymentType;
	party_type: string;
	party: string;
	party_account: string;
	bank_account: string;
	amount: number;
	posting_date: string;
	mode_of_payment: string;
	reference_no?: string;
	reference_date?: string;
	remarks?: string;
	allocations: Allocation[];
}

export function buildOnAccountPayment(input: OnAccountPayment, submit: boolean): Record<string, unknown> {
	const receiving = input.payment_type === "Receive";
	const amount = round2(input.amount);

	return {
		doctype: "Payment Entry",
		docstatus: submit ? 1 : 0,
		payment_type: input.payment_type,
		company: input.company,
		posting_date: input.posting_date,
		mode_of_payment: input.mode_of_payment || undefined,
		party_type: input.party_type,
		party: input.party,
		// Money comes out of the party and into the bank when receiving, and the reverse
		// when paying.
		paid_from: receiving ? input.party_account : input.bank_account,
		paid_to: receiving ? input.bank_account : input.party_account,
		paid_amount: amount,
		received_amount: amount,
		reference_no: input.reference_no || undefined,
		reference_date: input.reference_date || undefined,
		remarks: input.remarks || undefined,
		references: input.allocations.map((allocation) => ({ ...allocation })),
	};
}

/**
 * Adapt the document `get_payment_entry` returned to what the operator entered.
 *
 * Changing the bank side clears that side's currency and type so the server recomputes
 * them from the new account, rather than keeping values that belonged to the old one.
 */
export function adjustInvoicePayment(
	doc: Record<string, unknown>,
	changes: {
		amount: number;
		posting_date: string;
		mode_of_payment?: string;
		bank_account?: string;
		reference_no?: string;
		reference_date?: string;
		remarks?: string;
	},
	submit: boolean
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...doc, docstatus: submit ? 1 : 0 };
	const amount = round2(changes.amount);
	const receiving = next.payment_type === "Receive";

	next.posting_date = changes.posting_date;
	next.paid_amount = amount;
	next.received_amount = amount;
	if (changes.mode_of_payment) next.mode_of_payment = changes.mode_of_payment;
	if (changes.reference_no !== undefined) next.reference_no = changes.reference_no || undefined;
	if (changes.reference_date !== undefined) next.reference_date = changes.reference_date || undefined;
	if (changes.remarks) next.remarks = changes.remarks;

	if (changes.bank_account) {
		const side = receiving ? "paid_to" : "paid_from";
		if (next[side] !== changes.bank_account) {
			next[side] = changes.bank_account;
			delete next[`${side}_account_currency`];
			delete next[`${side}_account_type`];
			delete next[`${side}_account_balance`];
		}
	}

	let remaining = amount;
	next.references = ((doc.references as Record<string, unknown>[] | undefined) ?? []).map((reference) => {
		const allocated = round2(Math.max(0, Math.min(remaining, num(reference.outstanding_amount))));
		remaining = round2(remaining - allocated);
		return { ...reference, allocated_amount: allocated };
	});

	return next;
}

/** A payment the same currency on both sides; the app does not handle exchange. */
export function isSingleCurrency(doc: Record<string, unknown>): boolean {
	const from = doc.paid_from_account_currency;
	const to = doc.paid_to_account_currency;
	return !from || !to || from === to;
}
