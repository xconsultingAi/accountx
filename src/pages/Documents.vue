<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

import { DOC_TYPES, recentDocs, type DocSummary, type DocType } from "../api/erp";
import StatusTag from "../components/StatusTag.vue";
import { money, shortDate } from "../lib/format";
import { useSession } from "../stores/session";

const session = useSession();
const route = useRoute();
const router = useRouter();

const LABELS: Record<DocType, string> = {
	"Sales Invoice": "Sales",
	"Purchase Invoice": "Purchase",
	"Payment Entry": "Payments",
	"Journal Entry": "Journals",
};

const initial = DOC_TYPES.find((type) => type === route.query.type) ?? "Payment Entry";
const doctype = ref<DocType>(initial);
const search = ref("");
const docs = ref<DocSummary[]>([]);
const loading = ref(false);
const error = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;

async function load(): Promise<void> {
	loading.value = true;
	error.value = "";
	try {
		docs.value = await recentDocs(doctype.value, session.companyName, search.value);
	} catch (caught) {
		error.value = (caught as Error).message;
		docs.value = [];
	} finally {
		loading.value = false;
	}
}

watch(doctype, (type) => {
	router.replace({ query: { type } });
	load();
});
watch(search, () => {
	clearTimeout(timer);
	timer = setTimeout(load, 300);
});
onMounted(load);
</script>

<template>
	<main class="page">
		<h1>Documents</h1>

		<div class="segmented">
			<button v-for="type in DOC_TYPES" :key="type" :class="{ on: doctype === type }" @click="doctype = type">
				{{ LABELS[type] }}
			</button>
		</div>

		<label class="field">
			<input v-model="search" type="search" placeholder="Search by number or party" aria-label="Search" />
		</label>

		<div v-if="error" class="alert alert--error">{{ error }}</div>
		<div v-if="loading && !docs.length" class="spinner"></div>
		<ul v-else class="list">
			<li v-if="!docs.length" class="empty">Nothing found.</li>
			<li v-for="doc in docs" :key="doc.name">
				<RouterLink class="list__item" :to="{ name: 'doc', params: { doctype, name: doc.name } }">
					<div class="list__main">
						<strong>{{ doc.title || doc.name }}</strong>
						<span>{{ doc.name }} · {{ shortDate(doc.date) }}</span>
					</div>
					<div class="list__side">
						<strong class="num">{{ money(doc.amount, session.currency) }}</strong>
						<StatusTag :status="doc.status" :docstatus="doc.docstatus" />
					</div>
				</RouterLink>
			</li>
		</ul>
	</main>
</template>
