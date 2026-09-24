import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

import { useSession } from "./stores/session";

const routes: RouteRecordRaw[] = [
	{ path: "/login", name: "login", component: () => import("./pages/Login.vue"), meta: { public: true } },
	{ path: "/", name: "home", component: () => import("./pages/Dashboard.vue") },
	{
		path: "/receivable",
		name: "receivable",
		component: () => import("./pages/Outstanding.vue"),
		props: { kind: "sales" },
	},
	{
		path: "/payable",
		name: "payable",
		component: () => import("./pages/Outstanding.vue"),
		props: { kind: "purchase" },
	},
	{
		path: "/party/:partyType/:party",
		name: "party",
		component: () => import("./pages/Party.vue"),
		props: true,
	},
	{ path: "/ledger", name: "ledger", component: () => import("./pages/Ledger.vue") },
	{ path: "/documents", name: "documents", component: () => import("./pages/Documents.vue") },
	{
		path: "/doc/:doctype/:name",
		name: "doc",
		component: () => import("./pages/DocView.vue"),
		props: true,
	},
	{ path: "/new/payment", name: "new-payment", component: () => import("./pages/PaymentForm.vue") },
	{ path: "/new/journal", name: "new-journal", component: () => import("./pages/JournalForm.vue") },
	{
		path: "/new/invoice/:kind(sales|purchase)",
		name: "new-invoice",
		component: () => import("./pages/InvoiceForm.vue"),
		props: true,
	},
	{ path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
	history: createWebHistory(),
	routes,
	scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

router.beforeEach(async (to) => {
	const session = useSession();
	if (session.status === "loading") await session.init();

	if (to.meta.public) {
		return session.status === "ready" ? { name: "home" } : true;
	}
	if (session.status !== "ready") {
		return { name: "login", query: to.fullPath !== "/" ? { next: to.fullPath } : undefined };
	}
	return true;
});
