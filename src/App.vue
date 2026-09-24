<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";

import { useSession } from "./stores/session";

const session = useSession();
const route = useRoute();
const router = useRouter();

const online = ref(navigator.onLine);
const sheetOpen = ref(false);
const menuOpen = ref(false);

const setOnline = () => (online.value = navigator.onLine);
onMounted(() => {
	window.addEventListener("online", setOnline);
	window.addEventListener("offline", setOnline);
});
onBeforeUnmount(() => {
	window.removeEventListener("online", setOnline);
	window.removeEventListener("offline", setOnline);
});

// The session can end under any screen (expired on the server, signed out elsewhere).
watch(
	() => session.status,
	(status) => {
		if (status === "guest" && !route.meta.public) {
			router.replace({ name: "login", query: { next: route.fullPath } });
		}
	}
);

watch(
	() => route.fullPath,
	() => {
		sheetOpen.value = false;
		menuOpen.value = false;
	}
);

const showChrome = computed(() => session.status === "ready" && !route.meta.public);

const tabs = [
	{ to: "/", label: "Home", icon: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
	{ to: "/receivable", label: "Receivable", icon: "M12 4v12m0 0l-5-5m5 5l5-5M5 20h14" },
	{ to: "/payable", label: "Payable", icon: "M12 20V8m0 0l-5 5m5-5l5 5M5 4h14" },
	{ to: "/ledger", label: "Ledger", icon: "M5 4h11l3 3v13H5zM8 10h8M8 14h8M8 18h5" },
];

const newItems = [
	{ to: "/new/payment?type=Receive", label: "Receive payment", hint: "From a customer" },
	{ to: "/new/payment?type=Pay", label: "Make payment", hint: "To a supplier" },
	{ to: "/new/invoice/sales", label: "Sales invoice", hint: "Bill a customer" },
	{ to: "/new/invoice/purchase", label: "Purchase invoice", hint: "Record a supplier bill" },
	{ to: "/new/journal", label: "Journal entry", hint: "Debit and credit accounts" },
];

function isActive(to: string): boolean {
	return to === "/" ? route.path === "/" : route.path.startsWith(to);
}

async function signOut(): Promise<void> {
	await session.logout();
	router.replace({ name: "login" });
}
</script>

<template>
	<div class="shell" :class="{ 'shell--chrome': showChrome }">
		<div v-if="!online" class="banner banner--offline">You are offline. Figures can't be refreshed until you reconnect.</div>
		<div v-if="session.expired && route.meta.public" class="banner banner--warn">Your session ended. Please sign in again.</div>

		<header v-if="showChrome" class="topbar">
			<div class="topbar__title">
				<strong>{{ session.companyName }}</strong>
				<span>{{ session.fullName }}</span>
			</div>
			<button class="icon-btn" aria-label="Account menu" @click="menuOpen = !menuOpen">
				<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
			</button>
			<div v-if="menuOpen" class="menu" role="menu">
				<RouterLink to="/documents" class="menu__item" role="menuitem">All documents</RouterLink>
				<button class="menu__item menu__item--danger" role="menuitem" @click="signOut">Sign out</button>
			</div>
		</header>

		<main v-if="session.status === 'blocked'" class="page">
			<div class="card card--error">
				<h2>Can't open the company</h2>
				<p>{{ session.blockedReason }}</p>
				<button class="btn" @click="signOut">Sign out</button>
			</div>
		</main>
		<main v-else-if="session.status === 'loading'" class="page page--center">
			<div class="spinner" aria-label="Loading"></div>
		</main>
		<RouterView v-else />

		<nav v-if="showChrome" class="tabbar" aria-label="Main">
			<RouterLink v-for="tab in tabs.slice(0, 2)" :key="tab.to" :to="tab.to" class="tabbar__item" :class="{ on: isActive(tab.to) }">
				<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path :d="tab.icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
				<span>{{ tab.label }}</span>
			</RouterLink>
			<button class="tabbar__new" aria-label="Create new" @click="sheetOpen = true">
				<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
			</button>
			<RouterLink v-for="tab in tabs.slice(2)" :key="tab.to" :to="tab.to" class="tabbar__item" :class="{ on: isActive(tab.to) }">
				<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path :d="tab.icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
				<span>{{ tab.label }}</span>
			</RouterLink>
		</nav>

		<div v-if="sheetOpen" class="sheet-backdrop" @click.self="sheetOpen = false">
			<div class="sheet" role="dialog" aria-label="Create new">
				<div class="sheet__handle"></div>
				<h3>Create</h3>
				<RouterLink v-for="item in newItems" :key="item.to" :to="item.to" class="sheet__item">
					<strong>{{ item.label }}</strong>
					<span>{{ item.hint }}</span>
				</RouterLink>
			</div>
		</div>
	</div>
</template>
