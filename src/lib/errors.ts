/**
 * Turning a Frappe error response into one sentence a person can act on.
 *
 * Frappe reports failures in several places at once: `_server_messages` (a JSON string
 * of JSON strings, each holding a `message`), `_error_message`, and `exception` (the
 * Python class name followed by the text). The first of those is what the desk shows
 * the user, so it wins.
 */
export interface FrappeErrorBody {
	exc_type?: string;
	exception?: string;
	_server_messages?: string;
	_error_message?: string;
	message?: unknown;
}

export function stripHtml(text: string): string {
	return text
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li)>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

function serverMessages(raw: string | undefined): string[] {
	if (!raw) return [];
	try {
		const list = JSON.parse(raw) as unknown[];
		return list
			.map((entry) => {
				if (typeof entry !== "string") return "";
				try {
					const parsed = JSON.parse(entry) as { message?: string };
					return parsed.message ?? entry;
				} catch {
					return entry;
				}
			})
			.map((message) => stripHtml(String(message)))
			.filter(Boolean);
	} catch {
		return [];
	}
}

export function frappeErrorMessage(body: FrappeErrorBody | null | undefined): string {
	if (!body) return "";

	const messages = serverMessages(body._server_messages);
	if (messages.length) return messages.join("\n");

	if (body._error_message) return stripHtml(body._error_message);

	if (body.exception) {
		// "frappe.exceptions.ValidationError: Row 1: ..." -> "Row 1: ..."
		const text = body.exception.replace(/^[\w.]+(Error|Exception)?:\s*/, "");
		return stripHtml(text);
	}

	if (typeof body.message === "string" && body.exc_type) return stripHtml(body.message);
	return "";
}
