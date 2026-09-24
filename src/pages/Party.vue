<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";

import { getLedger, listOutstanding } from "../api/erp";
import LedgerList from "../components/LedgerList.vue";
import { bucketFor, type OpenInvoice } from "../lib/aging";
import { addDays, money, round2, shortDate, today } from "../lib/format";
import type { Ledger } from "../lib/ledger";
import { useSession } from "../stores/session";

const props = defineProps<{ partyType: string; party: string }>();
const session = useSession();

const kind = computed(() => (props.partyType === "Supplier" ? "purchase" : "sales"));
const invoiceDoctype = computed(() => (kind.value === "sales" ? "Sales Invoice" : "Purchase Invoice"));
const paymentType = computed(() => (kind.value === "sales" ? "Receive" : "Pay"));

const tab = ref<"invoices" | "ledger">("invoices");
const invoices = ref<OpenInvoice[]>([]);
const loading = ref(true);
const error = ref("");

const fromDate = ref(addDays(today(), -90));
const toDate = ref(today());
const ledger = ref<Ledger | null>(null);
const ledgerLoading = ref(false);
const ledgerError = ref("");

const partyName = computed(() => invoices.value[0]?.party_name || props.party);
const total = computed(() => round2(invoices.value.reduce((sum, invoice) => sum + invoice.outstanding_amount, 0)));

async function loadInvoices(): Promise<void> {
	loading.value = true;
	error.value = "";
	try {
		invoices.value = await listOutstanding(kind.value, session.companyName, props.party);
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		loading.value = false;
	}
}

async function loadLedger(): Promise<void> {
	ledgerLoading.value = true;
	ledgerError.value = "";
	try {
		ledger.value = await getLedger({
			company: session.companyName,
			from_date: fromDate.value,
			to_date: toDate.value,
			party_type: props.partyType,
			party: props.party,
		});
	} catch (caught) {
		ledgerError.value = (caught as Error).message;
	} finally {
		ledgerLoading.value = false;
	}
}

watch(tab, (value) => {
	if (value === "ledger" && !ledger.value) loadLedger();
});
watch(() => props.party, () => {
	ledger.value = null;
	loadInvoices();
	if (tab.value === "ledger") loadLedger();
});
onMounted(loadInvoices);
</script>

<template>
	<main class="page">
		<div class="page-head">
			<div>
				<h1>{{ partyName }}</h1>
				<div class="muted small">{{ partyType }} · {{ party }}</div>
			</div>
		</div>

		<div class="stats">
			<div class="stat">
				<div class="stat__label">Outstanding</div>
				<div class="stat__value">{{ money(total, session.currency) }}</div>
			</div>
			<RouterLink
				class="btn btn--primary"
				:to="{ name: 'new-payment', query: { type: paymentType, party_type: partyType, party } }"
			>
				{{ paymentType === "Receive" ? "Receive payment" : "Make payment" }}
			</RouterLink>
		</div>

		<div class="segmented">
			<button :class="{ on: tab === 'invoices' }" @click="tab = 'invoices'">Open invoices</button>
			<button :class="{ on: tab === 'ledger' }" @click="tab = 'ledger'">Ledger</button>
		</div>

		<template v-if="tab === 'invoices'">
			<div v-if="error" class="alert alert--error">{{ error }}</div>
			<div v-if="loading" class="spinner"></div>
			<ul v-else class="list">
				<li v-if="!invoices.length" class="empty">No open invoices.</li>
				<li v-for="invoice in invoices" :key="invoice.name" class="list__item">
					<RouterLink class="list__main" :to="{ name: 'doc', params: { doctype: invoiceDoctype, name: invoice.name } }">
						<strong>{{ invoice.name }}</strong>
						<span>
							Due {{ shortDate(invoice.due_date || invoice.posting_date) }}
							· {{ bucketFor(invoice) === "Not due" ? "not due" : `${bucketFor(invoice)} days` }}
						</span>
					</RouterLink>
					<div class="list__side">
						<strong class="num">{{ money(invoice.outstanding_amount, session.currency) }}</strong>
						<RouterLink
							v-if="invoice.outstanding_amount > 0"
							class="linkbtn small"
							:to="{ name: 'new-payment', query: { dt: invoiceDoctype, dn: invoice.name } }"
						>
							{{ paymentType === "Receive" ? "Receive" : "Pay" }}
						</RouterLink>
					</div>
				</li>
			</ul>
		</template>

		<template v-else>
			<form class="row" @submit.prevent="loadLedger">
				<label class="field"><span>From</span><input v-model="fromDate" type="date" required /></label>
				<label class="field"><span>To</span><input v-model="toDate" type="date" required /></label>
			</form>
			<button class="btn btn--block" style="margin-bottom: 12px" :disabled="ledgerLoading" @click="loadLedger">
				Show ledger
			</button>
			<div v-if="ledgerError" class="alert alert--error">{{ ledgerError }}</div>
			<div v-if="ledgerLoading" class="spinner"></div>
			<LedgerList v-else-if="ledger" :ledger="ledger" :currency="session.currency" />
		</template>
	</main>
</template>
