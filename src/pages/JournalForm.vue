<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";

import { insertDoc } from "../api/client";
import LinkField from "../components/LinkField.vue";
import { money, num, today } from "../lib/format";
import {
	VOUCHER_TYPES,
	buildJournal,
	checkJournal,
	defaultPartyType,
	needsParty,
	type AccountInfo,
	type JournalDraft,
	type JournalRow,
} from "../lib/journal";
import { useSession } from "../stores/session";

const session = useSession();
const router = useRouter();

const PARTY_TYPES = ["Customer", "Supplier", "Employee"];

function blankRow(): JournalRow {
	return { account: "", party_type: "", party: "", debit: "", credit: "" };
}

const draft = reactive<JournalDraft>({
	company: session.companyName,
	posting_date: today(),
	voucher_type: "Journal Entry",
	cheque_no: "",
	cheque_date: "",
	user_remark: "",
	rows: [blankRow(), blankRow()],
});

const accounts = ref<Map<string, AccountInfo>>(new Map());
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const problems = ref<string[]>([]);

const accountFilters = computed(() => ({ company: session.companyName, is_group: 0, disabled: 0 }));
const check = computed(() => checkJournal(draft, accounts.value));

onMounted(async () => {
	try {
		const list = await session.loadAccounts();
		accounts.value = new Map(list.map((account) => [account.name, account]));
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		loading.value = false;
	}
});

function onAccount(row: JournalRow): void {
	const account = accounts.value.get(row.account);
	if (!needsParty(account)) {
		row.party_type = "";
		row.party = "";
	} else if (!row.party_type) {
		row.party_type = defaultPartyType(account);
	}
}

/** Typing a debit clears the credit on the same line, and the other way round. */
function onAmount(row: JournalRow, side: "debit" | "credit"): void {
	if (num(row[side])) row[side === "debit" ? "credit" : "debit"] = "";
}

/** Put the current difference on this line, so the last line balances in one tap. */
function balanceInto(row: JournalRow): void {
	const others = draft.rows.filter((other) => other !== row);
	const diff = others.reduce((sum, other) => sum + num(other.debit) - num(other.credit), 0);
	if (diff > 0) {
		row.credit = diff.toFixed(2);
		row.debit = "";
	} else if (diff < 0) {
		row.debit = (-diff).toFixed(2);
		row.credit = "";
	}
}

function addRow(): void {
	draft.rows.push(blankRow());
}

function removeRow(index: number): void {
	draft.rows.splice(index, 1);
}

async function save(submit: boolean): Promise<void> {
	if (busy.value) return;
	error.value = "";
	problems.value = check.value.errors;
	if (problems.value.length) return;

	busy.value = true;
	try {
		const doc = buildJournal(draft, submit, {
			accounts: accounts.value,
			defaultCostCenter: session.company?.cost_center,
		});
		const saved = await insertDoc<{ name: string }>(doc);
		router.replace({ name: "doc", params: { doctype: "Journal Entry", name: saved.name }, query: { created: "1" } });
	} catch (caught) {
		error.value = (caught as Error).message;
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<main class="page">
		<h1>Journal entry</h1>

		<div v-if="loading" class="spinner"></div>
		<form v-else @submit.prevent="save(true)">
			<div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>
			<div v-if="problems.length" class="alert alert--error" role="alert">
				Please fix:
				<ul><li v-for="problem in problems" :key="problem">{{ problem }}</li></ul>
			</div>

			<div class="row">
				<label class="field">
					<span>Type</span>
					<select v-model="draft.voucher_type">
						<option v-for="type in VOUCHER_TYPES" :key="type" :value="type">{{ type }}</option>
					</select>
				</label>
				<label class="field">
					<span>Posting date</span>
					<input v-model="draft.posting_date" type="date" required />
				</label>
			</div>

			<div v-if="draft.voucher_type === 'Bank Entry'" class="row">
				<label class="field">
					<span>Reference / cheque no.</span>
					<input v-model="draft.cheque_no" type="text" required />
				</label>
				<label class="field">
					<span>Reference date</span>
					<input v-model="draft.cheque_date" type="date" required />
				</label>
			</div>

			<div v-for="(row, index) in draft.rows" :key="index" class="line">
				<div class="line__head">
					<span>Line {{ index + 1 }}</span>
					<span>
						<button type="button" class="linkbtn small" @click="balanceInto(row)">Balance</button>
						<button v-if="draft.rows.length > 2" type="button" class="remove" @click="removeRow(index)">Remove</button>
					</span>
				</div>

				<LinkField
					v-model="row.account"
					doctype="Account"
					:filters="accountFilters"
					placeholder="Search accounts"
					@select="onAccount(row)"
				/>

				<div v-if="needsParty(accounts.get(row.account))" class="row">
					<label class="field">
						<span>Party type</span>
						<select v-model="row.party_type" @change="row.party = ''">
							<option v-for="type in PARTY_TYPES" :key="type" :value="type">{{ type }}</option>
						</select>
					</label>
					<LinkField
						:key="row.party_type"
						v-model="row.party"
						:doctype="row.party_type || 'Customer'"
						label="Party"
						placeholder="Search"
					/>
				</div>

				<div class="row">
					<label class="field">
						<span>Debit</span>
						<input v-model="row.debit" type="text" inputmode="decimal" placeholder="0.00" @input="onAmount(row, 'debit')" />
					</label>
					<label class="field">
						<span>Credit</span>
						<input v-model="row.credit" type="text" inputmode="decimal" placeholder="0.00" @input="onAmount(row, 'credit')" />
					</label>
				</div>
			</div>

			<button type="button" class="btn btn--block" style="margin-bottom: 12px" @click="addRow">+ Add line</button>

			<div class="totals">
				<div><span>Total debit</span><span class="num">{{ money(check.totalDebit, session.currency) }}</span></div>
				<div><span>Total credit</span><span class="num">{{ money(check.totalCredit, session.currency) }}</span></div>
				<div class="grand" :style="{ color: check.difference ? 'var(--danger)' : 'var(--ok)' }">
					<span>Difference</span><span class="num">{{ money(check.difference, session.currency) }}</span>
				</div>
			</div>

			<label class="field">
				<span>Remark</span>
				<textarea v-model="draft.user_remark" rows="2"></textarea>
			</label>

			<div class="actions">
				<button type="button" class="btn" :disabled="busy" @click="save(false)">Save draft</button>
				<button type="submit" class="btn btn--primary" :disabled="busy">{{ busy ? "Saving…" : "Submit" }}</button>
			</div>
		</form>
	</main>
</template>
