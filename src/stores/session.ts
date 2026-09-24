/**
 * Who is signed in, and the company they are working in.
 *
 * The app serves exactly one company (VITE_COMPANY). It is checked right after sign-in
 * so a misconfigured name or a user without access to it fails with a clear message
 * instead of every screen coming back empty.
 */
import { defineStore } from "pinia";

import * as auth from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";
import { getCompany, getFullName, listAccounts, listCompanies, type Company } from "../api/erp";
import { COMPANY } from "../config";
import type { AccountInfo } from "../lib/journal";

type Status = "loading" | "guest" | "ready" | "blocked";

export const useSession = defineStore("session", {
	state: () => ({
		status: "loading" as Status,
		user: "" as string,
		fullName: "" as string,
		company: null as Company | null,
		blockedReason: "" as string,
		expired: false,
		accounts: null as AccountInfo[] | null,
	}),

	getters: {
		currency: (state) => state.company?.default_currency ?? "",
		companyName: (state) => state.company?.name ?? COMPANY,
	},

	actions: {
		async init(): Promise<void> {
			setUnauthorizedHandler(() => this.expire());

			const user = await auth.currentUser();
			if (!user) {
				this.status = "guest";
				return;
			}
			await this.enter(user);
		},

		async enter(user: string, fullName = ""): Promise<void> {
			this.user = user;
			this.fullName = fullName || (await getFullName(user));
			this.expired = false;

			let company: Company | null = null;
			try {
				company = await getCompany(COMPANY);
			} catch (error) {
				this.block((error as Error).message);
				return;
			}

			if (!company) {
				const visible = await listCompanies().catch(() => [] as string[]);
				this.block(
					visible.length
						? `Company "${COMPANY}" was not found. Your account can see: ${visible.join(", ")}. Set VITE_COMPANY to one of these.`
						: `Company "${COMPANY}" was not found, or your ERPNext account has no access to it.`
				);
				return;
			}

			this.company = company;
			this.status = "ready";
		},

		block(reason: string): void {
			this.blockedReason = reason;
			this.status = "blocked";
		},

		expire(): void {
			if (this.status !== "ready") return;
			this.expired = true;
			this.reset();
		},

		async logout(): Promise<void> {
			await auth.logout();
			this.expired = false;
			this.reset();
		},

		reset(): void {
			this.status = "guest";
			this.user = "";
			this.fullName = "";
			this.company = null;
			this.accounts = null;
		},

		/** Leaf accounts, loaded once per session. */
		async loadAccounts(force = false): Promise<AccountInfo[]> {
			if (!this.accounts || force) this.accounts = await listAccounts(this.companyName);
			return this.accounts;
		},
	},
});
