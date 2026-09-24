/**
 * Journal Entry: checking a draft before it goes to the server, and building the payload.
 *
 * ERPNext validates all of this too. Doing it here first means the operator sees every
 * problem at once, next to the row, instead of one server error at a time.
 */
import { num, round2 } from "./format";

export const VOUCHER_TYPES = [
	"Journal Entry",
	"Bank Entry",
	"Cash Entry",
	"Credit Note",
	"Debit Note",
	"Contra Entry",
	"Write Off Entry",
] as const;

export interface AccountInfo {
	name: string;
	account_name?: string;
	account_type: string | null;
	account_currency?: string | null;
	root_type?: string | null;
}

export interface JournalRow {
	account: string;
	party_type: string;
	party: string;
	debit: number | string;
	credit: number | string;
	cost_center?: string;
	user_remark?: string;
}

export interface JournalDraft {
	company: string;
	posting_date: string;
	voucher_type: string;
	cheque_no?: string;
	cheque_date?: string;
	user_remark?: string;
	rows: JournalRow[];
}

export interface JournalCheck {
	totalDebit: number;
	totalCredit: number;
	difference: number;
	errors: string[];
}

/** Receivable and payable accounts are posted per party; ERPNext refuses them without one. */
export function needsParty(account: AccountInfo | undefined): boolean {
	return account?.account_type === "Receivable" || account?.account_type === "Payable";
}

export function defaultPartyType(account: AccountInfo | undefined): string {
	if (account?.account_type === "Receivable") return "Customer";
	if (account?.account_type === "Payable") return "Supplier";
	return "";
}

export function checkJournal(draft: JournalDraft, accounts: Map<string, AccountInfo>): JournalCheck {
	const errors: string[] = [];
	let totalDebit = 0;
	let totalCredit = 0;

	const rows = draft.rows.filter((row) => row.account || num(row.debit) || num(row.credit));
	if (rows.length < 2) errors.push("A journal needs at least two lines.");

	rows.forEach((row, index) => {
		const line = `Line ${index + 1}`;
		const debit = round2(num(row.debit));
		const credit = round2(num(row.credit));

		if (!row.account) errors.push(`${line}: choose an account.`);
		else if (!accounts.has(row.account)) errors.push(`${line}: ${row.account} is not an account of this company.`);

		if (debit < 0 || credit < 0) errors.push(`${line}: amounts cannot be negative.`);
		if (debit && credit) errors.push(`${line}: enter either a debit or a credit, not both.`);
		if (!debit && !credit) errors.push(`${line}: enter a debit or a credit amount.`);

		if (needsParty(accounts.get(row.account)) && !(row.party_type && row.party)) {
			errors.push(`${line}: ${row.account} needs a party.`);
		}

		totalDebit += debit;
		totalCredit += credit;
	});

	totalDebit = round2(totalDebit);
	totalCredit = round2(totalCredit);
	const difference = round2(totalDebit - totalCredit);
	if (difference !== 0) errors.push(`Debits and credits differ by ${Math.abs(difference).toFixed(2)}.`);

	if (draft.voucher_type === "Bank Entry" && !(draft.cheque_no && draft.cheque_date)) {
		errors.push("A Bank Entry needs a reference number and reference date.");
	}
	if (!draft.posting_date) errors.push("Choose a posting date.");

	return { totalDebit, totalCredit, difference, errors };
}

/**
 * Profit-and-loss lines need a cost center, and the app has no screen for choosing one;
 * `defaultCostCenter` (the company's) is used for any income or expense line without one.
 */
export function buildJournal(
	draft: JournalDraft,
	submit: boolean,
	options: { accounts?: Map<string, AccountInfo>; defaultCostCenter?: string | null } = {}
): Record<string, unknown> {
	const costCenterFor = (row: JournalRow) => {
		if (row.cost_center) return row.cost_center;
		const rootType = options.accounts?.get(row.account)?.root_type;
		return rootType === "Income" || rootType === "Expense" ? options.defaultCostCenter || undefined : undefined;
	};

	return {
		doctype: "Journal Entry",
		docstatus: submit ? 1 : 0,
		company: draft.company,
		voucher_type: draft.voucher_type,
		posting_date: draft.posting_date,
		cheque_no: draft.cheque_no || undefined,
		cheque_date: draft.cheque_date || undefined,
		user_remark: draft.user_remark || undefined,
		accounts: draft.rows
			.filter((row) => row.account)
			.map((row) => ({
				account: row.account,
				party_type: row.party ? row.party_type : undefined,
				party: row.party || undefined,
				debit_in_account_currency: round2(num(row.debit)),
				credit_in_account_currency: round2(num(row.credit)),
				cost_center: costCenterFor(row),
				user_remark: row.user_remark || undefined,
			})),
	};
}
