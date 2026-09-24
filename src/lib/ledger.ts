/**
 * Reading ERPNext's General Ledger report.
 *
 * The report returns one list mixing real entries with its own summary rows. Summary
 * rows have no `posting_date` and carry a quoted label in `account` - `'Opening'`,
 * `'Total'`, `'Closing (Opening + Total)'` - translated into the site's language, so they
 * are recognised by their quotes and position rather than by the English text.
 */
import { num, round2 } from "./format";

export interface LedgerEntry {
	posting_date: string;
	account: string;
	voucher_type: string;
	voucher_no: string;
	against: string;
	party_type: string;
	party: string;
	remarks: string;
	debit: number;
	credit: number;
	balance: number;
}

export interface LedgerTotals {
	debit: number;
	credit: number;
	balance: number;
}

export interface Ledger {
	opening: LedgerTotals;
	entries: LedgerEntry[];
	total: LedgerTotals;
	closing: LedgerTotals;
}

type Row = Record<string, unknown>;

function totals(row: Row | undefined): LedgerTotals {
	const debit = round2(num(row?.debit));
	const credit = round2(num(row?.credit));
	return { debit, credit, balance: round2(debit - credit) };
}

function isSummary(row: Row): boolean {
	return !row.posting_date;
}

function label(row: Row): string {
	return String(row.account ?? "").replace(/^'+|'+$/g, "").toLowerCase();
}

export function parseLedger(result: unknown): Ledger {
	const rows = (Array.isArray(result) ? result : []).filter(
		(row): row is Row => !!row && typeof row === "object" && !Array.isArray(row)
	);

	const summaries = rows.filter(isSummary);
	const find = (english: string, fallback: Row | undefined) =>
		summaries.find((row) => label(row) === english) ?? fallback;

	// Opening is first, closing is last, total is in between - whatever language they are in.
	const opening = find("opening", summaries[0]);
	const closing = find("closing (opening + total)", summaries.length > 1 ? summaries[summaries.length - 1] : undefined);
	const total = find("total", summaries.length > 2 ? summaries[1] : undefined);

	let running = totals(opening).balance;
	const entries: LedgerEntry[] = rows
		.filter((row) => !isSummary(row))
		.map((row) => {
			const debit = round2(num(row.debit));
			const credit = round2(num(row.credit));
			running = round2(running + debit - credit);
			return {
				posting_date: String(row.posting_date).slice(0, 10),
				account: String(row.account ?? ""),
				voucher_type: String(row.voucher_type ?? ""),
				voucher_no: String(row.voucher_no ?? ""),
				against: String(row.against ?? ""),
				party_type: String(row.party_type ?? ""),
				party: String(row.party ?? ""),
				remarks: String(row.remarks ?? ""),
				debit,
				credit,
				// The report's own running balance resets per group; ours runs straight
				// through, which is what a single-party or single-account view wants.
				balance: running,
			};
		});

	const entryTotals = entries.reduce(
		(sum, entry) => ({ debit: sum.debit + entry.debit, credit: sum.credit + entry.credit }),
		{ debit: 0, credit: 0 }
	);
	const computedTotal = {
		debit: round2(entryTotals.debit),
		credit: round2(entryTotals.credit),
		balance: round2(entryTotals.debit - entryTotals.credit),
	};
	const openingTotals = totals(opening);

	return {
		opening: openingTotals,
		entries,
		total: total ? totals(total) : computedTotal,
		closing: closing
			? totals(closing)
			: {
					debit: round2(openingTotals.debit + computedTotal.debit),
					credit: round2(openingTotals.credit + computedTotal.credit),
					balance: round2(openingTotals.balance + computedTotal.balance),
				},
	};
}
