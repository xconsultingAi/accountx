import { describe, expect, it } from "vitest";

import { bucketFor, summarize, type OpenInvoice } from "../src/lib/aging";
import { frappeErrorMessage } from "../src/lib/errors";
import { addDays, daysBetween, round2, today } from "../src/lib/format";
import { buildInvoice, checkInvoice, estimateTaxes, type InvoiceDraft } from "../src/lib/invoice";
import { buildJournal, checkJournal, type AccountInfo, type JournalDraft } from "../src/lib/journal";
import { parseLedger } from "../src/lib/ledger";
import { adjustInvoicePayment, allocateOldestFirst, buildOnAccountPayment } from "../src/lib/payment";

describe("format", () => {
	it("gives local dates and day differences", () => {
		expect(today(new Date(2026, 0, 5))).toBe("2026-01-05");
		expect(addDays("2026-01-30", 3)).toBe("2026-02-02");
		expect(daysBetween("2026-01-01", "2026-03-01")).toBe(59);
	});

	it("rounds away float noise", () => {
		expect(round2(0.1 + 0.2)).toBe(0.3);
		expect(round2(1.005)).toBe(1.01);
		expect(round2(-1.005)).toBe(-1.01);
		expect(round2(1e-7)).toBe(0);
		expect(round2(-0.001)).toBe(0);
	});
});

describe("errors", () => {
	it("prefers the user-facing server message and strips HTML", () => {
		const body = {
			exc_type: "ValidationError",
			exception: "frappe.exceptions.ValidationError: raw",
			_server_messages: JSON.stringify([JSON.stringify({ message: "Row 1: <b>Account</b> is required" })]),
		};
		expect(frappeErrorMessage(body)).toBe("Row 1: Account is required");
	});

	it("falls back to the exception text without the class name", () => {
		expect(frappeErrorMessage({ exception: "frappe.exceptions.ValidationError: Totals differ" })).toBe("Totals differ");
	});
});

describe("aging", () => {
	const asOf = "2026-06-30";
	const invoice = (over: Partial<OpenInvoice>): OpenInvoice => ({
		name: "SINV-1",
		party: "C1",
		party_name: "Cust One",
		posting_date: "2026-06-01",
		due_date: "2026-06-30",
		grand_total: 100,
		outstanding_amount: 100,
		...over,
	});

	it("buckets by days past due", () => {
		expect(bucketFor(invoice({ due_date: "2026-07-10" }), asOf)).toBe("Not due");
		expect(bucketFor(invoice({ due_date: "2026-06-30" }), asOf)).toBe("Not due");
		expect(bucketFor(invoice({ due_date: "2026-06-29" }), asOf)).toBe("1-30");
		expect(bucketFor(invoice({ due_date: "2026-04-15" }), asOf)).toBe("61-90");
		expect(bucketFor(invoice({ due_date: "2026-01-01" }), asOf)).toBe("90+");
	});

	it("nets credit notes into their party and sorts by balance", () => {
		const summary = summarize(
			[
				invoice({ name: "A", outstanding_amount: 500, due_date: "2026-05-01" }),
				invoice({ name: "B", outstanding_amount: -200 }),
				invoice({ name: "C", party: "C2", party_name: "Two", outstanding_amount: 1000 }),
			],
			asOf
		);
		expect(summary.total).toBe(1300);
		expect(summary.overdue).toBe(500);
		expect(summary.parties.map((p) => [p.party, p.outstanding])).toEqual([
			["C2", 1000],
			["C1", 300],
		]);
	});
});

describe("journal", () => {
	const accounts = new Map<string, AccountInfo>([
		["Cash - IC", { name: "Cash - IC", account_type: "Cash", root_type: "Asset" }],
		["Debtors - IC", { name: "Debtors - IC", account_type: "Receivable", root_type: "Asset" }],
		["Rent - IC", { name: "Rent - IC", account_type: "", root_type: "Expense" }],
	]);
	const draft = (rows: JournalDraft["rows"], over: Partial<JournalDraft> = {}): JournalDraft => ({
		company: "inayatco",
		posting_date: "2026-06-30",
		voucher_type: "Journal Entry",
		rows,
		...over,
	});

	it("accepts a balanced entry", () => {
		const result = checkJournal(
			draft([
				{ account: "Rent - IC", party_type: "", party: "", debit: "100.10", credit: "" },
				{ account: "Cash - IC", party_type: "", party: "", debit: "", credit: 100.1 },
			]),
			accounts
		);
		expect(result.errors).toEqual([]);
		expect(result.difference).toBe(0);
	});

	it("reports imbalance, missing party and both sides on one line", () => {
		const result = checkJournal(
			draft([
				{ account: "Debtors - IC", party_type: "Customer", party: "", debit: 50, credit: 10 },
				{ account: "Cash - IC", party_type: "", party: "", debit: "", credit: 30 },
			]),
			accounts
		);
		expect(result.errors.join("\n")).toMatch(/either a debit or a credit/);
		expect(result.errors.join("\n")).toMatch(/needs a party/);
		expect(result.errors.join("\n")).toMatch(/differ by 10.00/);
	});

	it("requires a reference on bank entries", () => {
		const result = checkJournal(
			draft(
				[
					{ account: "Rent - IC", party_type: "", party: "", debit: 5, credit: "" },
					{ account: "Cash - IC", party_type: "", party: "", debit: "", credit: 5 },
				],
				{ voucher_type: "Bank Entry" }
			),
			accounts
		);
		expect(result.errors).toContain("A Bank Entry needs a reference number and reference date.");
	});

	it("builds account-currency amounts and a default cost center for P&L lines", () => {
		const doc = buildJournal(
			draft([
				{ account: "Rent - IC", party_type: "", party: "", debit: "100", credit: "" },
				{ account: "Cash - IC", party_type: "", party: "", debit: "", credit: "100" },
			]),
			true,
			{ accounts, defaultCostCenter: "Main - IC" }
		);
		expect(doc.docstatus).toBe(1);
		const rows = doc.accounts as Record<string, unknown>[];
		expect(rows[0]).toMatchObject({ debit_in_account_currency: 100, credit_in_account_currency: 0, cost_center: "Main - IC" });
		expect(rows[1].cost_center).toBeUndefined();
	});
});

describe("payment", () => {
	const refs = [
		{ doctype: "Sales Invoice" as const, name: "B", due_date: "2026-02-01", posting_date: "2026-01-01", outstanding_amount: 300 },
		{ doctype: "Sales Invoice" as const, name: "A", due_date: "2026-01-01", posting_date: "2026-01-01", outstanding_amount: 200 },
		{ doctype: "Sales Invoice" as const, name: "CN", due_date: "2026-01-01", posting_date: "2026-01-01", outstanding_amount: -50 },
	];

	it("allocates oldest first and never beyond the amount", () => {
		expect(allocateOldestFirst(refs, 350)).toEqual([
			{ reference_doctype: "Sales Invoice", reference_name: "A", allocated_amount: 200 },
			{ reference_doctype: "Sales Invoice", reference_name: "B", allocated_amount: 150 },
		]);
		expect(allocateOldestFirst(refs, 0)).toEqual([]);
	});

	it("routes money the right way for receive and pay", () => {
		const base = {
			company: "inayatco",
			party_type: "Customer",
			party: "C1",
			party_account: "Debtors - IC",
			bank_account: "Bank - IC",
			amount: 10,
			posting_date: "2026-06-30",
			mode_of_payment: "Bank",
			allocations: [],
		};
		expect(buildOnAccountPayment({ ...base, payment_type: "Receive" }, false)).toMatchObject({
			paid_from: "Debtors - IC",
			paid_to: "Bank - IC",
			docstatus: 0,
		});
		expect(buildOnAccountPayment({ ...base, payment_type: "Pay" }, true)).toMatchObject({
			paid_from: "Bank - IC",
			paid_to: "Debtors - IC",
			docstatus: 1,
		});
	});

	it("adjusts an ERPNext-built payment for a partial amount and a new bank", () => {
		const doc = {
			payment_type: "Receive",
			paid_to: "Cash - IC",
			paid_to_account_currency: "PKR",
			paid_amount: 500,
			references: [{ reference_name: "A", outstanding_amount: 500, allocated_amount: 500 }],
		};
		const next = adjustInvoicePayment(doc, { amount: 200, posting_date: "2026-06-30", bank_account: "Bank - IC" }, true);
		expect(next).toMatchObject({ paid_amount: 200, received_amount: 200, paid_to: "Bank - IC", docstatus: 1 });
		expect(next.paid_to_account_currency).toBeUndefined();
		expect((next.references as { allocated_amount: number }[])[0].allocated_amount).toBe(200);
	});
});

describe("ledger", () => {
	it("separates summary rows from entries and runs the balance", () => {
		const ledger = parseLedger([
			{ account: "'Opening'", debit: 100, credit: 0 },
			{ posting_date: "2026-06-01", account: "Debtors - IC", voucher_type: "Sales Invoice", voucher_no: "S1", debit: 50, credit: 0 },
			{ posting_date: "2026-06-02", account: "Debtors - IC", voucher_type: "Payment Entry", voucher_no: "P1", debit: 0, credit: 120 },
			{ account: "'Total'", debit: 50, credit: 120 },
			{ account: "'Closing (Opening + Total)'", debit: 150, credit: 120 },
		]);
		expect(ledger.opening.balance).toBe(100);
		expect(ledger.entries.map((e) => e.balance)).toEqual([150, 30]);
		expect(ledger.total).toEqual({ debit: 50, credit: 120, balance: -70 });
		expect(ledger.closing.balance).toBe(30);
	});

	it("recognises translated summary labels by position", () => {
		const ledger = parseLedger([
			{ account: "'Apertura'", debit: 10, credit: 0 },
			{ posting_date: "2026-06-01", voucher_no: "J1", debit: 0, credit: 4 },
			{ account: "'Totale'", debit: 0, credit: 4 },
			{ account: "'Chiusura'", debit: 10, credit: 4 },
		]);
		expect(ledger.opening.balance).toBe(10);
		expect(ledger.closing.balance).toBe(6);
	});
});

describe("invoice", () => {
	const draft: InvoiceDraft = {
		kind: "purchase",
		company: "inayatco",
		party: "S1",
		posting_date: "2026-06-30",
		bill_no: "INV-9",
		taxes: [
			{ charge_type: "On Net Total", account_head: "GST - IC", rate: 17 },
			{ charge_type: "Actual", account_head: "Freight - IC", tax_amount: 50 },
		],
		taxes_and_charges: "GST 17%",
		lines: [
			{ item_code: "ITEM-1", qty: 2, rate: 100 },
			{ item_code: "", qty: 1, rate: 5 },
		],
	};

	it("estimates template taxes", () => {
		expect(estimateTaxes(200, draft.taxes)).toEqual({ amount: 84, approximate: false });
		expect(estimateTaxes(200, [{ charge_type: "On Previous Row Total", account_head: "X" }]).approximate).toBe(true);
	});

	it("keeps the chosen posting date and drops empty lines", () => {
		const doc = buildInvoice(draft, false);
		expect(doc).toMatchObject({ doctype: "Purchase Invoice", supplier: "S1", set_posting_time: 1, bill_no: "INV-9" });
		expect(doc.items).toEqual([{ item_code: "ITEM-1", qty: 2, rate: 100 }]);
		expect(checkInvoice(draft)).toEqual([]);
		expect(checkInvoice({ ...draft, party: "", lines: [] })).toHaveLength(2);
	});
});
