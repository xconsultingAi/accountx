/**
 * Username + password sign-in against ERPNext, including two-factor when the site has it
 * switched on.
 *
 * Frappe's `/api/method/login` either signs the user in or, with 2FA enabled, answers
 * with a `verification` block and a `tmp_id`. The second step posts the code with that
 * `tmp_id`; the server recalls the username and password it cached against it.
 */
import { call, request } from "./client";

export interface Verification {
	method?: string;
	prompt?: string;
	setup?: boolean;
	qrcode_url?: string;
}

export type LoginResult =
	| { status: "ok"; fullName: string }
	| { status: "otp"; tmpId: string; prompt: string };

interface LoginResponse {
	message?: string;
	full_name?: string;
	verification?: Verification;
	tmp_id?: string;
}

function toResult(response: LoginResponse): LoginResult {
	if (response.verification && response.tmp_id) {
		const verification = response.verification;
		const prompt =
			verification.prompt ||
			(verification.method === "OTP App"
				? "Enter the code from your authenticator app."
				: `Enter the code sent by ${verification.method ?? "ERPNext"}.`);
		return { status: "otp", tmpId: response.tmp_id, prompt };
	}
	return { status: "ok", fullName: response.full_name ?? "" };
}

export async function login(usr: string, pwd: string): Promise<LoginResult> {
	return toResult(await request<LoginResponse>("/api/method/login", { body: { usr, pwd }, anonymous: true }));
}

export async function verifyOtp(tmpId: string, otp: string): Promise<LoginResult> {
	return toResult(
		await request<LoginResponse>("/api/method/login", { body: { tmp_id: tmpId, otp }, anonymous: true })
	);
}

export async function logout(): Promise<void> {
	await request("/api/method/logout", { body: {}, anonymous: true }).catch(() => undefined);
}

/** The signed-in user's id, or null for Guest / no session. */
export async function currentUser(): Promise<string | null> {
	try {
		const user = await call<string>("frappe.auth.get_logged_user", {}, true);
		return user && user !== "Guest" ? user : null;
	} catch {
		return null;
	}
}
