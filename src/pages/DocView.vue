<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";

import { cancelDoc, submitDoc } from "../api/client";
import { loadDoc } from "../api/erp";
import StatusTag from "../components/StatusTag.vue";
import { ERP_DESK_URL } from "../config";
import { money, num, shortDate } from "../lib/format";
import { useSession } from "../stores/session";

const props = defineProps<{ doctype: string; name: string }>();
const session = useSession();
const route = useRoute();

type Doc = Record<string, unknown>;
const doc = ref<Doc | null>(null);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const notice = ref(route.query.created ? "Saved." : "");

async function load(): Promise<void> {
	loading.value = true;
	error.value = "";
	try {
		doc.value = await loadDoc(props.doctype, props.name);
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		loading.value = false;
	}
}

watch(() => [props.doctype, props.name], load);
onMounted(load);

const currency = computed(() => String(doc.value?.currency ?? doc.value?.paid_from_account_currency ?? session.currency));
const docstatus = computed(() => Number(doc.value?.docstatus ?? 0));
const isInvoice = computed(() => props.doctype === "Sales Invoice" || props.doctype === "Purchase Invoice");

const fields = computed<[string, string][]>(() => {
	const d = doc.value;
	if (!d) return [];
	const m = (value: unknown) => money(value, currency.value);
	const rows: [string, unknown][] = [];

	if (isInvoice.value) {
		rows.push(
			[props.doctype === "Sales Invoice" ? "Customer" : "Supplier", d.customer_name ?? d.supplier_name],
			["Posting date", shortDate(d.posting_date as string)],
			["Due date", shortDate(d.due_date as string)],
			["Supplier invoice", d.bill_no],
			["Net total", m(d.net_total)],
			["Taxes", num(d.total_taxes_and_charges) ? m(d.total_taxes_and_charges) : ""],
			["Grand total", m(d.grand_total)],
			["Outstanding", m(d.outstanding_amount)]
		);
	} else if (props.doctype === "Payment Entry") {
		rows.push(
			["Type", d.payment_type],
			["Party", d.party_name ?? d.party],
			["Posting date", shortDate(d.posting_date as string)],
			["Mode", d.mode_of_payment],
			["Amount", m(d.paid_amount)],
			["From", d.paid_from],
			["To", d.paid_to],
			["Reference", [d.reference_no, shortDate(d.reference_date as string)].filter(Boolean).join(" · ")],
			["Unallocated", num(d.unallocated_amount) ? m(d.unallocated_amount) : ""]
		);
	} else if (props.doctype === "Journal Entry") {
		rows.push(
			["Type", d.voucher_type],
			["Posting date", shortDate(d.posting_date as string)],
			["Reference", [d.cheque_no, shortDate(d.cheque_date as string)].filter(Boolean).join(" · ")],
			["Total debit", m(d.total_debit)],
			["Total credit", m(d.total_credit)]
		);
	}

	const remark = d.remarks ?? d.user_remark;
	if (remark) rows.push(["Remarks", remark]);
	return rows.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([k, v]) => [k, String(v)]);
});

const lines = computed(() => {
	const d = doc.value;
	if (!d) return [];
	const m = (value: unknown) => money(value, currency.value);
	type Line = { key: string; title: string; sub: string; amount: string };

	if (isInvoice.value) {
		return ((d.items as Doc[]) ?? []).map<Line>((item, index) => ({
			key: String(item.name ?? index),
			title: String(item.item_name ?? item.item_code),
			sub: `${num(item.qty)} × ${m(item.rate)}`,
			amount: m(item.amount),
		}));
	}
	if (props.doctype === "Payment Entry") {
		return ((d.references as Doc[]) ?? []).map<Line>((ref, index) => ({
			key: String(ref.name ?? index),
			title: String(ref.reference_name),
			sub: String(ref.reference_doctype),
			amount: m(ref.allocated_amount),
		}));
	}
	if (props.doctype === "Journal Entry") {
		return ((d.accounts as Doc[]) ?? []).map<Line>((row, index) => ({
			key: String(row.name ?? index),
			title: String(row.account),
			sub: row.party ? `${row.party_type}: ${row.party}` : "",
			amount: num(row.debit_in_account_currency)
				? `${m(row.debit_in_account_currency)} Dr`
				: `${m(row.credit_in_account_currency)} Cr`,
		}));
	}
	return [];
});

const linesTitle = computed(() =>
	isInvoice.value ? "Items" : props.doctype === "Payment Entry" ? "Allocated to" : "Accounts"
);

const canPay = computed(() => isInvoice.value && docstatus.value === 1 && num(doc.value?.outstanding_amount) > 0);

const pdfUrl = computed(
	() =>
		`/api/method/frappe.utils.print_format.download_pdf?doctype=${encodeURIComponent(props.doctype)}&name=${encodeURIComponent(props.name)}`
);
const deskUrl = computed(() =>
	ERP_DESK_URL ? `${ERP_DESK_URL}/app/${props.doctype.toLowerCase().replace(/ /g, "-")}/${encodeURIComponent(props.name)}` : ""
);

async function submit(): Promise<void> {
	if (busy.value || !confirm(`Submit ${props.name}? Submitted documents post to the ledger.`)) return;
	busy.value = true;
	error.value = "";
	try {
		await submitDoc(props.doctype, props.name);
		notice.value = "Submitted.";
		await load();
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		busy.value = false;
	}
}

async function cancel(): Promise<void> {
	if (busy.value || !confirm(`Cancel ${props.name}? This reverses its ledger entries and cannot be undone.`)) return;
	busy.value = true;
	error.value = "";
	try {
		await cancelDoc(props.doctype, props.name);
		notice.value = "Cancelled.";
		await load();
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<main class="page">
		<div class="page-head">
			<div>
				<div class="muted small">{{ doctype }}</div>
				<h1>{{ name }}</h1>
			</div>
			<StatusTag v-if="doc" :status="doc.status as string" :docstatus="docstatus" />
		</div>

		<div v-if="notice" class="alert alert--info">{{ notice }}</div>
		<div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
		<div v-if="loading" class="spinner"></div>

		<template v-else-if="doc">
			<div class="card">
				<dl class="kv">
					<template v-for="[label, value] in fields" :key="label">
						<dt>{{ label }}</dt>
						<dd>{{ value }}</dd>
					</template>
				</dl>
			</div>

			<template v-if="lines.length">
				<h2>{{ linesTitle }}</h2>
				<ul class="list">
					<li v-for="line in lines" :key="line.key" class="list__item">
						<div class="list__main">
							<strong>{{ line.title }}</strong>
							<span v-if="line.sub">{{ line.sub }}</span>
						</div>
						<strong class="num">{{ line.amount }}</strong>
					</li>
				</ul>
			</template>

			<RouterLink
				v-if="canPay"
				class="btn btn--primary btn--block"
				style="margin-bottom: 10px"
				:to="{ name: 'new-payment', query: { dt: doctype, dn: name } }"
			>
				{{ doctype === "Sales Invoice" ? "Receive payment" : "Pay this invoice" }}
			</RouterLink>

			<div class="actions">
				<button v-if="docstatus === 0" class="btn btn--primary" :disabled="busy" @click="submit">Submit</button>
				<button v-if="docstatus === 1" class="btn btn--danger" :disabled="busy" @click="cancel">Cancel</button>
				<a class="btn" :href="pdfUrl" target="_blank" rel="noopener">PDF</a>
				<a v-if="deskUrl" class="btn" :href="deskUrl" target="_blank" rel="noopener">Open in ERPNext</a>
			</div>
		</template>
	</main>
</template>
