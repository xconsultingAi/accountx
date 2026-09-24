/**
 * Receivable / payable ageing, from open invoices.
 *
 * Buckets are measured from the due date (falling back to the posting date), which is
 * how ERPNext's Accounts Receivable report ages by default.
 */
import { daysBetween, num, round2, today } from "./format";

export interface OpenInvoice {
	name: string;
	party: string;
	party_name: string;
	posting_date: string;
	due_date: string | null;
	grand_total: number;
	outstanding_amount: number;
	currency?: string;
	status?: string;
}

export const BUCKETS = ["Not due", "1-30", "31-60", "61-90", "90+"] as const;
export type Bucket = (typeof BUCKETS)[number];

export function bucketFor(invoice: Pick<OpenInvoice, "due_date" | "posting_date">, asOf: string = today()): Bucket {
	const overdueBy = daysBetween(invoice.due_date || invoice.posting_date, asOf);
	if (overdueBy <= 0) return "Not due";
	if (overdueBy <= 30) return "1-30";
	if (overdueBy <= 60) return "31-60";
	if (overdueBy <= 90) return "61-90";
	return "90+";
}

export interface PartyBalance {
	party: string;
	party_name: string;
	outstanding: number;
	overdue: number;
	count: number;
	oldest_due: string | null;
	buckets: Record<Bucket, number>;
}

export interface AgingSummary {
	total: number;
	overdue: number;
	buckets: Record<Bucket, number>;
	parties: PartyBalance[];
}

function emptyBuckets(): Record<Bucket, number> {
	return { "Not due": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
}

/**
 * Totals, buckets and one line per party, largest balance first.
 *
 * Credit notes arrive with a negative outstanding and are netted into their party, the
 * same way ERPNext nets them, so a customer who returned goods is not shown as owing
 * the full original amount.
 */
export function summarize(invoices: OpenInvoice[], asOf: string = today()): AgingSummary {
	const summary: AgingSummary = { total: 0, overdue: 0, buckets: emptyBuckets(), parties: [] };
	const byParty = new Map<string, PartyBalance>();

	for (const invoice of invoices) {
		const amount = num(invoice.outstanding_amount);
		if (!amount) continue;

		const bucket = bucketFor(invoice, asOf);
		const due = invoice.due_date || invoice.posting_date;

		let party = byParty.get(invoice.party);
		if (!party) {
			party = {
				party: invoice.party,
				party_name: invoice.party_name || invoice.party,
				outstanding: 0,
				overdue: 0,
				count: 0,
				oldest_due: null,
				buckets: emptyBuckets(),
			};
			byParty.set(invoice.party, party);
		}

		party.outstanding += amount;
		party.count += 1;
		party.buckets[bucket] += amount;
		if (bucket !== "Not due") party.overdue += amount;
		if (amount > 0 && (!party.oldest_due || due < party.oldest_due)) party.oldest_due = due;

		summary.total += amount;
		summary.buckets[bucket] += amount;
		if (bucket !== "Not due") summary.overdue += amount;
	}

	summary.total = round2(summary.total);
	summary.overdue = round2(summary.overdue);
	for (const bucket of BUCKETS) summary.buckets[bucket] = round2(summary.buckets[bucket]);

	summary.parties = [...byParty.values()]
		.map((party) => ({
			...party,
			outstanding: round2(party.outstanding),
			overdue: round2(party.overdue),
		}))
		.filter((party) => party.outstanding !== 0)
		.sort((a, b) => b.outstanding - a.outstanding);

	return summary;
}
