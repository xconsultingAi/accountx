<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { insertDoc } from "../api/client";
import { itemRate, taxRows } from "../api/erp";
import LinkField from "../components/LinkField.vue";
import { money, num, today } from "../lib/format";
import {
	INVOICE_DOCTYPE,
	PARTY_TYPE,
	TAX_TEMPLATE_DOCTYPE,
	buildInvoice,
	checkInvoice,
	estimateTaxes,
	lineAmount,
	netTotal,
	type InvoiceDraft,
	type InvoiceKind,
	type InvoiceLine,
} from "../lib/invoice";
import type { LinkOption } from "../api/erp";
import { useSession } from "../stores/session";

const props = defineProps<{ kind: InvoiceKind }>();
const session = useSession();
const router = useRouter();

function blankLine(): InvoiceLine {
	return { item_code: "", item_name: "", qty: 1, rate: "" };
}

function blankDraft(): InvoiceDraft {
	return {
		kind: props.kind,
		company: session.companyName,
		party: "",
		posting_date: today(),
		due_date: "",
		bill_no: "",
		bill_date: "",
		remarks: "",
		taxes_and_charges: "",
		taxes: [],
		lines: [blankLine()],
	};
}

const draft = reactive<InvoiceDraft>(blankDraft());
const partyLabel = ref("");
const busy = ref(false);
const error = ref("");
const problems = ref<string[]>([]);

watch(
	() => props.kind,
	() => {
		Object.assign(draft, blankDraft());
		partyLabel.value = "";
		problems.value = [];
		error.value = "";
	}
);

const partyType = computed(() => PARTY_TYPE[props.kind]);
const itemFilters = computed(() =>
	props.kind === "sales"
		? { is_sales_item: 1, disabled: 0, has_variants: 0 }
		: { is_purchase_item: 1, disabled: 0, has_variants: 0 }
);
const templateFilters = computed(() => ({ company: session.companyName, disabled: 0 }));

const net = computed(() => netTotal(draft.lines));
const tax = computed(() => estimateTaxes(net.value, draft.taxes));
const grand = computed(() => net.value + tax.value.amount);

function onParty(option: LinkOption | null): void {
	partyLabel.value = option?.label || option?.description?.split(",")[0]?.trim() || option?.value || "";
}

async function onItem(line: InvoiceLine, option: LinkOption | null): Promise<void> {
	line.item_name = option?.description || option?.label || "";
	if (!line.item_code) return;
	try {
		const rate = await itemRate(line.item_code, props.kind);
		if (rate !== null && !num(line.rate)) line.rate = rate;
	} catch {
		// No readable price list is fine; the operator types the rate.
	}
}

async function onTemplate(): Promise<void> {
	draft.taxes = [];
	if (!draft.taxes_and_charges) return;
	try {
		draft.taxes = await taxRows(TAX_TEMPLATE_DOCTYPE[props.kind], draft.taxes_and_charges);
	} catch (caught) {
		error.value = (caught as Error).message;
		draft.taxes_and_charges = "";
	}
}

async function save(submit: boolean): Promise<void> {
	if (busy.value) return;
	error.value = "";
	problems.value = checkInvoice(draft);
	if (problems.value.length) return;

	busy.value = true;
	try {
		const saved = await insertDoc<{ name: string }>(buildInvoice(draft, submit));
		router.replace({
			name: "doc",
			params: { doctype: INVOICE_DOCTYPE[props.kind], name: saved.name },
			query: { created: "1" },
		});
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<main class="page">
		<h1>{{ INVOICE_DOCTYPE[kind] }}</h1>

		<form @submit.prevent="save(true)">
			<div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
			<div v-if="problems.length" class="alert alert--error" role="alert">
				Please fix:
				<ul><li v-for="problem in problems" :key="problem">{{ problem }}</li></ul>
			</div>

			<LinkField
				:key="partyType"
				v-model="draft.party"
				:doctype="partyType"
				:label="partyType"
				:display="partyLabel"
				:placeholder="`Search ${partyType.toLowerCase()}s`"
				@select="onParty"
			/>

			<div class="row">
				<label class="field">
					<span>Posting date</span>
					<input v-model="draft.posting_date" type="date" required />
				</label>
				<label class="field">
					<span>Due date (optional)</span>
					<input v-model="draft.due_date" type="date" :min="draft.posting_date" />
				</label>
			</div>

			<div v-if="kind === 'purchase'" class="row">
				<label class="field">
					<span>Supplier invoice no.</span>
					<input v-model="draft.bill_no" type="text" />
				</label>
				<label class="field">
					<span>Supplier invoice date</span>
					<input v-model="draft.bill_date" type="date" />
				</label>
			</div>

			<h2>Items</h2>
			<div v-for="(line, index) in draft.lines" :key="index" class="line">
				<div class="line__head">
					<span>Item {{ index + 1 }}</span>
					<button v-if="draft.lines.length > 1" type="button" class="remove" @click="draft.lines.splice(index, 1)">
						Remove
					</button>
				</div>
				<LinkField
					v-model="line.item_code"
					doctype="Item"
					:filters="itemFilters"
					:display="line.item_name ? `${line.item_code}: ${line.item_name}` : ''"
					placeholder="Search items"
					@select="(option) => onItem(line, option)"
				/>
				<div class="row">
					<label class="field">
						<span>Qty</span>
						<input v-model="line.qty" type="text" inputmode="decimal" />
					</label>
					<label class="field">
						<span>Rate</span>
						<input v-model="line.rate" type="text" inputmode="decimal" placeholder="0.00" />
					</label>
				</div>
				<div class="muted small num">Amount {{ money(lineAmount(line), session.currency) }}</div>
			</div>
			<button type="button" class="btn btn--block" style="margin-bottom: 12px" @click="draft.lines.push(blankLine())">
				+ Add item
			</button>

			<LinkField
				v-model="draft.taxes_and_charges"
				:doctype="TAX_TEMPLATE_DOCTYPE[kind]"
				label="Tax template (optional)"
				:filters="templateFilters"
				placeholder="No tax"
				@select="onTemplate"
			/>

			<div class="totals">
				<div><span>Net total</span><span class="num">{{ money(net, session.currency) }}</span></div>
				<div v-if="draft.taxes.length">
					<span>Taxes{{ tax.approximate ? " (estimate)" : "" }}</span>
					<span class="num">{{ money(tax.amount, session.currency) }}</span>
				</div>
				<div class="grand"><span>Grand total</span><span class="num">{{ money(grand, session.currency) }}</span></div>
				<div class="muted small">ERPNext calculates the final totals when the invoice is saved.</div>
			</div>

			<label class="field">
				<span>Remarks (optional)</span>
				<textarea v-model="draft.remarks" rows="2"></textarea>
			</label>

			<div class="actions">
				<button type="button" class="btn" :disabled="busy" @click="save(false)">Save draft</button>
				<button type="submit" class="btn btn--primary" :disabled="busy">{{ busy ? "Saving…" : "Submit" }}</button>
			</div>
		</form>
	</main>
</template>
