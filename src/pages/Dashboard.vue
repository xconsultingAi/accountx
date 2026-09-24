<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";

import { listOutstanding, recentDocs, type DocSummary } from "../api/erp";
import StatusTag from "../components/StatusTag.vue";
import { summarize, type AgingSummary } from "../lib/aging";
import { money, shortDate } from "../lib/format";
import { useSession } from "../stores/session";

const session = useSession();

const receivable = ref<AgingSummary | null>(null);
const payable = ref<AgingSummary | null>(null);
const recentPayments = ref<DocSummary[]>([]);
const loading = ref(true);
const error = ref("");

async function load(): Promise<void> {
	loading.value = true;
	error.value = "";
	const company = session.companyName;

	// Independent, so one failing (a missing role, say) still shows the others.
	const [ar, ap, payments] = await Promise.allSettled([
		listOutstanding("sales", company),
		listOutstanding("purchase", company),
		recentDocs("Payment Entry", company),
	]);

	if (ar.status === "fulfilled") receivable.value = summarize(ar.value);
	if (ap.status === "fulfilled") payable.value = summarize(ap.value);
	if (payments.status === "fulfilled") recentPayments.value = payments.value.slice(0, 6);

	const failed = [ar, ap, payments].find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
	if (failed) error.value = (failed.reason as Error).message;
	loading.value = false;
}

onMounted(load);
</script>

<template>
	<main class="page">
		<div class="page-head">
			<h1>Overview</h1>
			<button class="btn btn--small" :disabled="loading" @click="load">Refresh</button>
		</div>

		<div v-if="error" class="alert alert--error">{{ error }}</div>

		<div class="stats">
			<RouterLink to="/receivable" class="stat">
				<div class="stat__label">Receivable</div>
				<div class="stat__value">{{ receivable ? money(receivable.total, session.currency) : "…" }}</div>
				<div v-if="receivable?.overdue" class="stat__sub">{{ money(receivable.overdue, session.currency) }} overdue</div>
			</RouterLink>
			<RouterLink to="/payable" class="stat">
				<div class="stat__label">Payable</div>
				<div class="stat__value">{{ payable ? money(payable.total, session.currency) : "…" }}</div>
				<div v-if="payable?.overdue" class="stat__sub">{{ money(payable.overdue, session.currency) }} overdue</div>
			</RouterLink>
		</div>

		<div class="stats">
			<RouterLink to="/new/payment?type=Receive" class="btn btn--primary">Receive payment</RouterLink>
			<RouterLink to="/new/payment?type=Pay" class="btn">Make payment</RouterLink>
		</div>

		<template v-if="receivable?.parties.length">
			<h2>Top customers owing</h2>
			<ul class="list">
				<li v-for="party in receivable.parties.slice(0, 5)" :key="party.party">
					<RouterLink
						class="list__item"
						:to="{ name: 'party', params: { partyType: 'Customer', party: party.party } }"
					>
						<div class="list__main">
							<strong>{{ party.party_name }}</strong>
							<span>{{ party.count }} open invoice{{ party.count === 1 ? "" : "s" }}</span>
						</div>
						<div class="list__side">
							<strong class="num">{{ money(party.outstanding, session.currency) }}</strong>
							<span v-if="party.overdue" class="tag tag--overdue">{{ money(party.overdue, session.currency) }} overdue</span>
						</div>
					</RouterLink>
				</li>
			</ul>
		</template>

		<div class="page-head">
			<h2>Recent payments</h2>
			<RouterLink to="/documents?type=Payment%20Entry" class="small">See all</RouterLink>
		</div>
		<ul class="list">
			<li v-if="!loading && !recentPayments.length" class="empty">No payments yet.</li>
			<li v-for="doc in recentPayments" :key="doc.name">
				<RouterLink class="list__item" :to="{ name: 'doc', params: { doctype: 'Payment Entry', name: doc.name } }">
					<div class="list__main">
						<strong>{{ doc.title }}</strong>
						<span>{{ doc.name }} · {{ shortDate(doc.date) }}</span>
					</div>
					<div class="list__side">
						<strong class="num">{{ money(doc.amount, session.currency) }}</strong>
						<StatusTag :status="doc.status" :docstatus="doc.docstatus" />
					</div>
				</RouterLink>
			</li>
		</ul>
		<div v-if="loading" class="spinner"></div>
	</main>
</template>
