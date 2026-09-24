<script setup lang="ts">
import { RouterLink } from "vue-router";

import type { Ledger } from "../lib/ledger";
import { money, shortDate } from "../lib/format";

defineProps<{ ledger: Ledger; currency: string }>();

/** Positive balances are debits, negative ones credits - the way ERPNext prints them. */
function balance(value: number, currency: string): string {
	if (!value) return money(0, currency);
	return `${money(Math.abs(value), currency)} ${value > 0 ? "Dr" : "Cr"}`;
}

const OPENABLE = new Set(["Sales Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"]);
</script>

<template>
	<div class="list">
		<div class="ledger-row ledger-row--summary">
			<span>Opening balance</span>
			<span class="num">{{ balance(ledger.opening.balance, currency) }}</span>
		</div>

		<div v-if="!ledger.entries.length" class="empty">No entries in this period.</div>

		<div v-for="(entry, index) in ledger.entries" :key="`${entry.voucher_no}-${index}`" class="ledger-row">
			<div>
				<RouterLink
					v-if="OPENABLE.has(entry.voucher_type)"
					:to="{ name: 'doc', params: { doctype: entry.voucher_type, name: entry.voucher_no } }"
				>
					{{ entry.voucher_no }}
				</RouterLink>
				<span v-else>{{ entry.voucher_no }}</span>
				<div class="ledger-row__meta">
					{{ shortDate(entry.posting_date) }} · {{ entry.voucher_type }}
					<template v-if="entry.against"> · {{ entry.against }}</template>
				</div>
			</div>
			<div class="num">
				<div v-if="entry.debit" class="dr">{{ money(entry.debit, currency) }} Dr</div>
				<div v-if="entry.credit" class="cr">{{ money(entry.credit, currency) }} Cr</div>
				<div class="ledger-row__meta">Bal {{ balance(entry.balance, currency) }}</div>
			</div>
		</div>

		<div class="ledger-row ledger-row--summary">
			<span>Period total</span>
			<span class="num small">
				{{ money(ledger.total.debit, currency) }} Dr · {{ money(ledger.total.credit, currency) }} Cr
			</span>
		</div>
		<div class="ledger-row ledger-row--summary">
			<span>Closing balance</span>
			<span class="num">{{ balance(ledger.closing.balance, currency) }}</span>
		</div>
	</div>
</template>
