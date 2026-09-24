/** Numbers and dates the way the rest of the app shows them. */

/** Today as `YYYY-MM-DD` in the device's timezone, which is what ERPNext expects. */
export function today(now: Date = new Date()): string {
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
	const [y, m, d] = date.split("-").map(Number);
	return today(new Date(y, m - 1, d + days));
}

export function firstOfMonth(date: string = today()): string {
	return `${date.slice(0, 7)}-01`;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
	const [fy, fm, fd] = from.split("-").map(Number);
	const [ty, tm, td] = to.split("-").map(Number);
	return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Round to cents. Floating point must never decide whether a journal balances. */
export function round2(value: number): number {
	const n = Number(value) || 0;
	// Shift through the decimal string, not `n * 100`: 1.005 * 100 is 100.49999…, which
	// would round a half cent down. Halves round away from zero on both signs.
	const abs = Math.abs(n);
	const text = String(abs);
	const shifted = Math.round(text.includes("e") ? abs * 100 : Number(`${text}e2`));
	return (Math.sign(n) * shifted) / 100 || 0;
}

export function num(value: unknown): number {
	const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
	return Number.isFinite(parsed) ? parsed : 0;
}

const formatters = new Map<string, Intl.NumberFormat>();

export function money(value: unknown, currency = ""): string {
	const key = currency || "-";
	let formatter = formatters.get(key);
	if (!formatter) {
		try {
			formatter = currency
				? new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 })
				: new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		} catch {
			formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		}
		formatters.set(key, formatter);
	}
	return formatter.format(num(value));
}

export function shortDate(date: string | null | undefined): string {
	if (!date) return "";
	const [y, m, d] = date.slice(0, 10).split("-").map(Number);
	if (!y || !m || !d) return date;
	return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
