/**
 * The only module that speaks HTTP.
 *
 * Every URL is relative: the app is served from the same origin as the ERPNext API
 * (a dev-server proxy locally, a reverse proxy in production), because the session
 * cookie a password login creates is `SameSite=Lax` and is never sent cross-site.
 */
import { frappeErrorMessage, type FrappeErrorBody } from "../lib/errors";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly excType?: string
	) {
		super(message);
		this.name = "ApiError";
	}

	get isPermission(): boolean {
		return this.status === 403 || this.excType === "PermissionError";
	}
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Called once when the server says the session is gone, so the app can show login. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
	onUnauthorized = handler;
}

let checkingSession: Promise<void> | null = null;

/**
 * A 403 is either "you may not do this" or "you are no longer signed in" - Frappe answers
 * a Guest calling a protected method with the same status. Asking who we are tells the
 * two apart without logging someone out for trying something they lack the role for.
 */
function confirmSession(): Promise<void> {
	if (!checkingSession) {
		checkingSession = fetch("/api/method/frappe.auth.get_logged_user", {
			credentials: "include",
			headers: { Accept: "application/json" },
		})
			.then(async (response) => {
				const body = (await response.json().catch(() => ({}))) as { message?: string };
				if (!response.ok || !body.message || body.message === "Guest") onUnauthorized?.();
			})
			.catch(() => undefined)
			.finally(() => {
				checkingSession = null;
			});
	}
	return checkingSession;
}

export interface RequestOptions {
	method?: "GET" | "POST" | "PUT" | "DELETE";
	body?: unknown;
	/** Skip the session check on failure (used by login itself). */
	anonymous?: boolean;
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
	const method = options.method ?? (options.body === undefined ? "GET" : "POST");
	const headers: Record<string, string> = { Accept: "application/json" };
	if (options.body !== undefined) headers["Content-Type"] = "application/json";

	let response: Response;
	try {
		response = await fetch(path, {
			method,
			headers,
			credentials: "include",
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
	} catch {
		throw new ApiError(
			navigator.onLine ? "Could not reach ERPNext. Try again in a moment." : "You are offline.",
			0
		);
	}

	const text = await response.text();
	let body: (FrappeErrorBody & Record<string, unknown>) | null = null;
	try {
		body = text ? JSON.parse(text) : {};
	} catch {
		body = null;
	}

	if (!response.ok || body?.exc_type) {
		const message =
			frappeErrorMessage(body) ||
			(response.status === 403
				? "You do not have permission to do that."
				: response.status >= 500
					? "ERPNext returned a server error."
					: `Request failed (${response.status}).`);
		const error = new ApiError(message, response.status, body?.exc_type);

		if (!options.anonymous) {
			if (response.status === 401) onUnauthorized?.();
			else if (response.status === 403) await confirmSession();
		}
		throw error;
	}

	if (body === null) throw new ApiError("ERPNext sent a response the app could not read.", response.status);
	return body as T;
}

/** Call a whitelisted Python method and return its `message`. */
export async function call<T = unknown>(method: string, args: Record<string, unknown> = {}, get = false): Promise<T> {
	if (get) {
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(args)) {
			if (value === undefined || value === null) continue;
			query.set(key, typeof value === "string" ? value : JSON.stringify(value));
		}
		const suffix = query.toString() ? `?${query}` : "";
		return (await request<{ message: T }>(`/api/method/${method}${suffix}`)).message;
	}
	return (await request<{ message: T }>(`/api/method/${method}`, { body: args })).message;
}

export interface ListOptions {
	fields?: string[];
	filters?: unknown[];
	orFilters?: unknown[];
	orderBy?: string;
	limit?: number;
	start?: number;
}

export async function getList<T = Record<string, unknown>>(doctype: string, options: ListOptions = {}): Promise<T[]> {
	const query = new URLSearchParams();
	query.set("fields", JSON.stringify(options.fields ?? ["name"]));
	if (options.filters?.length) query.set("filters", JSON.stringify(options.filters));
	if (options.orFilters?.length) query.set("or_filters", JSON.stringify(options.orFilters));
	if (options.orderBy) query.set("order_by", options.orderBy);
	query.set("limit_page_length", String(options.limit ?? 20));
	if (options.start) query.set("limit_start", String(options.start));

	const body = await request<{ data: T[] }>(`/api/resource/${encodeURIComponent(doctype)}?${query}`);
	return body.data ?? [];
}

export async function getDoc<T = Record<string, unknown>>(doctype: string, name: string): Promise<T> {
	const body = await request<{ data: T }>(`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`);
	return body.data;
}

/**
 * Insert a document. With `docstatus: 1` in the payload Frappe inserts and submits in one
 * transaction, so a failed submit never leaves a half-made draft behind.
 */
export async function insertDoc<T = Record<string, unknown>>(doc: Record<string, unknown>): Promise<T> {
	const doctype = String(doc.doctype);
	const body = await request<{ data: T }>(`/api/resource/${encodeURIComponent(doctype)}`, { body: doc });
	return body.data;
}

export async function submitDoc<T = Record<string, unknown>>(doctype: string, name: string): Promise<T> {
	const body = await request<{ data: T }>(
		`/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
		{ method: "PUT", body: { docstatus: 1 } }
	);
	return body.data;
}

export async function cancelDoc(doctype: string, name: string): Promise<void> {
	await call("frappe.client.cancel", { doctype, name });
}
