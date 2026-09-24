<script setup lang="ts">
/**
 * Receive from a customer or pay a supplier.
 *
 * Opened from an invoice (`?dt=&dn=`) the payment is ERPNext's own `get_payment_entry`
 * document with only amount, date and mode changed. Opened for a party
 * (`?type=&party_type=&party=`) it is built here and, by default, allocated to that
 * party's oldest open invoices so it clears them instead of sitting as an advance.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { insertDoc } from "../api/client";
import { bankAccountFor, listModesOfPayment, openReferences, partyDetails, paymentEntryFor } from "../api/erp";
import LinkField from "../components/LinkField.vue";
import { money, num, round2, shortDate, today } from "../lib/format";
import {
	adjustInvoicePayment,
	allocateOldestFirst,
	buildOnAccountPayment,
	isSingleCurrency,
	type OpenReference,
	type PaymentType,
} from "../lib/payment";
import { useSession } from "../stores/session";

const session = useSession();
const route = useRoute();
const router = useRouter();

const fromInvoice = computed(() => typeof route.query.dt === "string" && typeof route.query.dn === "string");

const loading = ref(true);
const busy = ref(false);
const error = ref("");
const problems = ref<string[]>([]);

const invoiceDoc = ref<Record<string, unknown> | null>(null);
const paymentType = ref<PaymentType>(route.query.type === "Pay" ? "Pay" : "Receive");
const partyType = ref(typeof route.query.party_type === "string" ? route.query.party_type : "");
const party = ref(typeof route.query.party === "string" ? route.query.party : "");
const partyLabel = ref("");
const partyAccount = ref("");
const partyCurrency = ref("");

const modes = ref<string[]>([]);
const modeOfPayment = ref("");
const bankAccount = ref("");
const bankError = ref("");

const amount = ref<number | string>("");
const postingDate = ref(today());
const referenceNo = ref("");
const referenceDate = ref(today());
const remarks = ref("");

const allocate = ref(true);
const openRefs = ref<OpenReference[]>([]);

const receiving = computed(() => paymentType.value === "Receive");
const bankIsBank = computed(
	() => (session.accounts ?? []).find((account) => account.name === bankAccount.value)?.account_type === "Bank"
);
const openTotal = computed(() => round2(openRefs.value.reduce((sum, ref) => sum + num(ref.outstanding_amount), 0)));
const allocations = computed(() => (allocate.value ? allocateOldestFirst(openRefs.value, num(amount.value)) : []));
const invoiceOutstanding = computed(() =>
	round2(
		((invoiceDoc.value?.references as Record<string, unknown>[] | undefined) ?? []).reduce(
			(sum, row) => sum + num(row.outstanding_amount),
			0
		)
	)
);

watch(paymentType, (type) => {
	if (fromInvoice.value) return;
	partyType.value = type === "Receive" ? "Customer" : "Supplier";
	party.value = "";
	partyLabel.value = "";
});

async function onParty(): Promise<void> {
	partyAccount.value = "";
	partyCurrency.value = "";
	openRefs.value = [];
	if (!party.value) return;
	try {
		const details = await partyDetails(session.companyName, partyType.value, party.value, postingDate.value);
		partyAccount.value = details.party_account;
		partyCurrency.value = details.party_account_currency;
		partyLabel.value = details.party_name || party.value;
		openRefs.value = await openReferences(paymentType.value, session.companyName, party.value);
	} catch (caught) {
		error.value = (caught as Error).message;
	}
}

async function onMode(): Promise<void> {
	bankError.value = "";
	bankAccount.value = "";
	if (!modeOfPayment.value) return;
	try {
		bankAccount.value = await bankAccountFor(modeOfPayment.value, session.companyName);
	} catch (caught) {
		bankError.value = (caught as Error).message;
	}
}

onMounted(async () => {
	try {
		const [modeList] = await Promise.all([listModesOfPayment(), session.loadAccounts().catch(() => [])]);
		modes.value = modeList;

		if (fromInvoice.value) {
			const doc = await paymentEntryFor(String(route.query.dt), String(route.query.dn));
			invoiceDoc.value = doc;
			paymentType.value = doc.payment_type === "Pay" ? "Pay" : "Receive";
			partyType.value = String(doc.party_type ?? "");
			party.value = String(doc.party ?? "");
			partyLabel.value = String(doc.party_name ?? doc.party ?? "");
			amount.value = num(doc.paid_amount);
			modeOfPayment.value = String(doc.mode_of_payment ?? "");
			bankAccount.value = String((doc.payment_type === "Pay" ? doc.paid_from : doc.paid_to) ?? "");
			if (!isSingleCurrency(doc)) {
				error.value = "This invoice is in a different currency from the bank account. Record it in ERPNext.";
			}
		} else {
			if (!partyType.value) partyType.value = receiving.value ? "Customer" : "Supplier";
			if (party.value) await onParty();
		}

		if (!modeOfPayment.value && modes.value.length === 1) {
			modeOfPayment.value = modes.value[0];
			await onMode();
		}
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		loading.value = false;
	}
});

function validate(): string[] {
	const list: string[] = [];
	if (!party.value) list.push(`Choose a ${partyType.value.toLowerCase() || "party"}.`);
	if (num(amount.value) <= 0) list.push("Enter an amount greater than zero.");
	if (!modeOfPayment.value) list.push("Choose a mode of payment.");
	if (!bankAccount.value) list.push("The mode of payment has no bank or cash account for this company.");
	if (!postingDate.value) list.push("Choose a posting date.");
	if (bankIsBank.value && !(referenceNo.value.trim() && referenceDate.value)) {
		list.push("Bank payments need a reference / cheque number and date.");
	}
	if (!fromInvoice.value && partyCurrency.value && session.currency && partyCurrency.value !== session.currency) {
		list.push(`This party is billed in ${partyCurrency.value}. Foreign-currency payments must be made in ERPNext.`);
	}
	return list;
}

async function save(submit: boolean): Promise<void> {
	if (busy.value) return;
	error.value = "";
	problems.value = validate();
	if (problems.value.length) return;

	busy.value = true;
	try {
		const common = {
			amount: num(amount.value),
			posting_date: postingDate.value,
			mode_of_payment: modeOfPayment.value,
			reference_no: referenceNo.value.trim(),
			reference_date: referenceNo.value.trim() ? referenceDate.value : "",
			remarks: remarks.value.trim(),
		};

		const doc = invoiceDoc.value
			? adjustInvoicePayment(invoiceDoc.value, { ...common, bank_account: bankAccount.value }, submit)
			: buildOnAccountPayment(
					{
						...common,
						company: session.companyName,
						payment_type: paymentType.value,
						party_type: partyType.value,
						party: party.value,
						party_account: partyAccount.value,
						bank_account: bankAccount.value,
						allocations: allocations.value,
					},
					submit
				);

		const saved = await insertDoc<{ name: string }>(doc);
		router.replace({ name: "doc", params: { doctype: "Payment Entry", name: saved.name }, query: { created: "1" } });
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<main class="page">
		<h1>{{ receiving ? "Receive payment" : "Make payment" }}</h1>

		<div v-if="loading" class="spinner"></div>
		<form v-else @submit.prevent="save(true)">
			<div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
			<div v-if="problems.length" class="alert alert--error" role="alert">
				Please fix:
				<ul><li v-for="problem in problems" :key="problem">{{ problem }}</li></ul>
			</div>

			<template v-if="invoiceDoc">
				<div class="card">
					<dl class="kv">
						<dt>{{ partyType }}</dt>
						<dd>{{ partyLabel }}</dd>
						<dt>Against</dt>
						<dd>{{ route.query.dn }}</dd>
						<dt>Outstanding</dt>
						<dd class="num">{{ money(invoiceOutstanding, session.currency) }}</dd>
					</dl>
				</div>
			</template>
			<template v-else>
				<div class="segmented">
					<button type="button" :class="{ on: receiving }" @click="paymentType = 'Receive'">Receive</button>
					<button type="button" :class="{ on: !receiving }" @click="paymentType = 'Pay'">Pay</button>
				</div>
				<LinkField
					:key="partyType"
					v-model="party"
					:doctype="partyType"
					:label="partyType"
					:display="partyLabel"
					:placeholder="`Search ${partyType.toLowerCase()}s`"
					@select="onParty"
				/>
				<p v-if="party && openRefs.length" class="muted small" style="margin-top: -6px">
					{{ openRefs.length }} open invoice{{ openRefs.length === 1 ? "" : "s" }} ·
					{{ money(openTotal, session.currency) }} outstanding
				</p>
			</template>

			<label class="field">
				<span>Amount ({{ session.currency }})</span>
				<input v-model="amount" type="text" inputmode="decimal" placeholder="0.00" required />
			</label>

			<div class="row">
				<label class="field">
					<span>Mode of payment</span>
					<select v-model="modeOfPayment" required @change="onMode">
						<option value="" disabled>Choose…</option>
						<option v-for="mode in modes" :key="mode" :value="mode">{{ mode }}</option>
					</select>
				</label>
				<label class="field">
					<span>Posting date</span>
					<input v-model="postingDate" type="date" required />
				</label>
			</div>
			<p v-if="bankError" class="alert alert--error">{{ bankError }}</p>
			<p v-else-if="bankAccount" class="muted small" style="margin-top: -6px">
				{{ receiving ? "Deposited to" : "Paid from" }} {{ bankAccount }}
			</p>

			<div class="row">
				<label class="field">
					<span>Reference / cheque no.{{ bankIsBank ? "" : " (optional)" }}</span>
					<input v-model="referenceNo" type="text" :required="bankIsBank" />
				</label>
				<label class="field">
					<span>Reference date</span>
					<input v-model="referenceDate" type="date" :required="bankIsBank" />
				</label>
			</div>

			<label class="field">
				<span>Remarks (optional)</span>
				<textarea v-model="remarks" rows="2"></textarea>
			</label>

			<template v-if="!invoiceDoc && openRefs.length">
				<label class="field" style="flex-direction: row; align-items: center; gap: 8px">
					<input v-model="allocate" type="checkbox" style="width: auto; min-height: 0" />
					<span>Settle oldest open invoices first</span>
				</label>
				<ul v-if="allocations.length" class="list">
					<li v-for="allocation in allocations" :key="allocation.reference_name" class="list__item">
						<div class="list__main">
							<strong>{{ allocation.reference_name }}</strong>
							<span>
								Due {{ shortDate(openRefs.find((row) => row.name === allocation.reference_name)?.due_date) }}
							</span>
						</div>
						<strong class="num">{{ money(allocation.allocated_amount, session.currency) }}</strong>
					</li>
				</ul>
				<p v-if="!allocate" class="muted small">The whole amount is recorded as an advance on account.</p>
			</template>

			<div class="actions">
				<button type="button" class="btn" :disabled="busy" @click="save(false)">Save draft</button>
				<button type="submit" class="btn btn--primary" :disabled="busy">{{ busy ? "Saving…" : "Submit" }}</button>
			</div>
		</form>
	</main>
</template>
