<script setup lang="ts">
import { computed, ref } from "vue";

import { getLedger } from "../api/erp";
import LedgerList from "../components/LedgerList.vue";
import LinkField from "../components/LinkField.vue";
import { firstOfMonth, today } from "../lib/format";
import type { Ledger } from "../lib/ledger";
import { useSession } from "../stores/session";

const session = useSession();

type Mode = "Account" | "Customer" | "Supplier";
const mode = ref<Mode>("Account");
const target = ref("");
const targetLabel = ref("");
const fromDate = ref(firstOfMonth());
const toDate = ref(today());

const ledger = ref<Ledger | null>(null);
const loading = ref(false);
const error = ref("");

const linkFilters = computed(() =>
	mode.value === "Account" ? { company: session.companyName, is_group: 0 } : undefined
);

function setMode(next: Mode): void {
	mode.value = next;
	target.value = "";
	targetLabel.value = "";
	ledger.value = null;
}

async function load(): Promise<void> {
	if (!target.value) {
		error.value = `Choose ${mode.value === "Account" ? "an account" : `a ${mode.value.toLowerCase()}`} first.`;
		return;
	}
	loading.value = true;
	error.value = "";
	try {
		ledger.value = await getLedger({
			company: session.companyName,
			from_date: fromDate.value,
			to_date: toDate.value,
			account: mode.value === "Account" ? target.value : undefined,
			party_type: mode.value === "Account" ? undefined : mode.value,
			party: mode.value === "Account" ? undefined : target.value,
		});
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		loading.value = false;
	}
}
</script>

<template>
	<main class="page">
		<h1>General ledger</h1>

		<div class="segmented">
			<button v-for="option in ['Account', 'Customer', 'Supplier'] as Mode[]" :key="option" :class="{ on: mode === option }" @click="setMode(option)">
				{{ option }}
			</button>
		</div>

		<form @submit.prevent="load">
			<LinkField
				:key="mode"
				v-model="target"
				:doctype="mode"
				:label="mode"
				:filters="linkFilters"
				:display="targetLabel"
				:placeholder="`Search ${mode.toLowerCase()}s`"
				@select="(option) => (targetLabel = option?.label || option?.value || '')"
			/>
			<div class="row">
				<label class="field"><span>From</span><input v-model="fromDate" type="date" required /></label>
				<label class="field"><span>To</span><input v-model="toDate" type="date" required /></label>
			</div>
			<button class="btn btn--primary btn--block" type="submit" :disabled="loading" style="margin-bottom: 12px">
				{{ loading ? "Loading…" : "Show ledger" }}
			</button>
		</form>

		<div v-if="error" class="alert alert--error">{{ error }}</div>
		<LedgerList v-if="ledger && !loading" :ledger="ledger" :currency="session.currency" />
	</main>
</template>
