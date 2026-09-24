<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import { OUTSTANDING_LIMIT, listOutstanding } from "../api/erp";
import { BUCKETS, summarize, type AgingSummary } from "../lib/aging";
import { money } from "../lib/format";
import type { InvoiceKind } from "../lib/invoice";
import { useSession } from "../stores/session";

const props = defineProps<{ kind: InvoiceKind }>();
const session = useSession();

const summary = ref<AgingSummary | null>(null);
const truncated = ref(false);
const loading = ref(true);
const error = ref("");
const search = ref("");
const overdueOnly = ref(false);

const title = computed(() => (props.kind === "sales" ? "Receivable" : "Payable"));
const partyType = computed(() => (props.kind === "sales" ? "Customer" : "Supplier"));

async function load(): Promise<void> {
	loading.value = true;
	error.value = "";
	try {
		const invoices = await listOutstanding(props.kind, session.companyName);
		truncated.value = invoices.length >= OUTSTANDING_LIMIT;
		summary.value = summarize(invoices);
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		loading.value = false;
	}
}

const parties = computed(() => {
	const terms = search.value.trim().toLowerCase();
	return (summary.value?.parties ?? []).filter(
		(party) =>
			(!overdueOnly.value || party.overdue > 0) &&
			(!terms || `${party.party} ${party.party_name}`.toLowerCase().includes(terms))
	);
});

watch(() => props.kind, load);
onMounted(load);
</script>

<template>
	<main class="page">
		<div class="page-head">
			<h1>{{ title }}</h1>
			<RouterLink
				:to="kind === 'sales' ? '/new/invoice/sales' : '/new/invoice/purchase'"
				class="btn btn--small"
			>
				New invoice
			</RouterLink>
		</div>

		<div v-if="error" class="alert alert--error">{{ error }}</div>
		<div v-if="truncated" class="alert alert--warn">
			Showing the first {{ OUTSTANDING_LIMIT }} open invoices. Totals may be incomplete.
		</div>

		<template v-if="summary">
			<div class="stats">
				<div class="stat">
					<div class="stat__label">Outstanding</div>
					<div class="stat__value">{{ money(summary.total, session.currency) }}</div>
				</div>
				<div class="stat">
					<div class="stat__label">Overdue</div>
					<div class="stat__value">{{ money(summary.overdue, session.currency) }}</div>
				</div>
			</div>

			<div class="buckets" aria-label="Ageing by days overdue">
				<div v-for="bucket in BUCKETS" :key="bucket" class="bucket">
					<span>{{ bucket }}</span>
					<strong>{{ money(summary.buckets[bucket]) }}</strong>
				</div>
			</div>
		</template>

		<label class="field">
			<input v-model="search" type="search" :placeholder="`Search ${partyType.toLowerCase()}s`" aria-label="Search" />
		</label>
		<div class="segmented">
			<button :class="{ on: !overdueOnly }" @click="overdueOnly = false">All</button>
			<button :class="{ on: overdueOnly }" @click="overdueOnly = true">Overdue only</button>
		</div>

		<div v-if="loading" class="spinner"></div>
		<ul v-else class="list">
			<li v-if="!parties.length" class="empty">Nothing outstanding.</li>
			<li v-for="party in parties" :key="party.party">
				<RouterLink class="list__item" :to="{ name: 'party', params: { partyType, party: party.party } }">
					<div class="list__main">
						<strong>{{ party.party_name }}</strong>
						<span>
							{{ party.count }} invoice{{ party.count === 1 ? "" : "s" }}
							<template v-if="party.oldest_due"> · oldest due {{ party.oldest_due }}</template>
						</span>
					</div>
					<div class="list__side">
						<strong class="num">{{ money(party.outstanding, session.currency) }}</strong>
						<span v-if="party.overdue" class="tag tag--overdue">{{ money(party.overdue, session.currency) }} overdue</span>
					</div>
				</RouterLink>
			</li>
		</ul>
	</main>
</template>
