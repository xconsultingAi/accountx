<script setup lang="ts">
/**
 * Search-and-pick for an ERPNext Link, backed by the same `search_link` the desk uses,
 * so search fields and permissions match what users see in ERPNext.
 *
 * The value only changes when a result is picked: typed text that was never picked is
 * put back on blur, so a half-typed name can never be sent as a party or item.
 */
import { onBeforeUnmount, ref, watch } from "vue";

import { searchLink, type LinkOption } from "../api/erp";

const props = withDefaults(
	defineProps<{
		modelValue: string;
		doctype: string;
		label?: string;
		placeholder?: string;
		filters?: unknown;
		disabled?: boolean;
		/** Text shown for the current value, e.g. a customer's name. */
		display?: string;
	}>(),
	{ label: "", placeholder: "Search", filters: undefined, disabled: false, display: "" }
);

const emit = defineEmits<{
	"update:modelValue": [value: string];
	select: [option: LinkOption | null];
}>();

const text = ref(props.display || props.modelValue);
const options = ref<LinkOption[]>([]);
const open = ref(false);
const loading = ref(false);
const error = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;

watch(
	() => [props.modelValue, props.display],
	() => {
		text.value = props.display || props.modelValue;
	}
);

function search(): void {
	clearTimeout(timer);
	timer = setTimeout(async () => {
		const mine = ++sequence;
		loading.value = true;
		error.value = "";
		try {
			const results = await searchLink(props.doctype, text.value.trim(), props.filters);
			// A slower earlier search must not overwrite a newer one.
			if (mine === sequence) options.value = results;
		} catch (caught) {
			if (mine === sequence) error.value = (caught as Error).message;
		} finally {
			if (mine === sequence) loading.value = false;
		}
	}, 220);
}

function onFocus(): void {
	open.value = true;
	search();
}

function onInput(): void {
	open.value = true;
	search();
}

function pick(option: LinkOption): void {
	text.value = option.label || option.value;
	open.value = false;
	emit("update:modelValue", option.value);
	emit("select", option);
}

function onBlur(): void {
	// Let a tap on a result land before the list closes.
	setTimeout(() => {
		open.value = false;
		if (!text.value.trim()) {
			if (props.modelValue) {
				emit("update:modelValue", "");
				emit("select", null);
			}
			return;
		}
		text.value = props.display || props.modelValue;
	}, 180);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
	<div class="field">
		<span v-if="label">{{ label }}</span>
		<input
			v-model="text"
			type="search"
			autocomplete="off"
			autocapitalize="off"
			:placeholder="placeholder"
			:aria-label="label || placeholder"
			:disabled="disabled"
			@focus="onFocus"
			@input="onInput"
			@blur="onBlur"
		/>
		<ul v-if="open" class="dropdown">
			<li v-if="loading && !options.length" class="dropdown__empty">Searching…</li>
			<li v-else-if="error" class="dropdown__empty dropdown__error">{{ error }}</li>
			<li v-else-if="!options.length" class="dropdown__empty">No matches</li>
			<li v-for="option in options" :key="option.value">
				<button type="button" @mousedown.prevent @click="pick(option)">
					<strong>{{ option.label || option.value }}</strong>
					<span v-if="option.description || (option.label && option.label !== option.value)">
						{{ option.label && option.label !== option.value ? option.value : "" }}
						{{ option.description }}
					</span>
				</button>
			</li>
		</ul>
	</div>
</template>

<style scoped>
.dropdown {
	position: absolute;
	top: 100%;
	left: 0;
	right: 0;
	z-index: 15;
	max-height: 280px;
	margin: 4px 0 0;
	padding: 4px;
	overflow-y: auto;
	list-style: none;
	background: var(--surface);
	border: 1px solid var(--border);
	border-radius: 12px;
	box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
}

.dropdown button {
	display: flex;
	flex-direction: column;
	width: 100%;
	padding: 10px;
	border: 0;
	border-radius: 8px;
	background: none;
	color: var(--text);
	font: inherit;
	text-align: left;
}

.dropdown button:active {
	background: var(--surface-2);
}

.dropdown span {
	color: var(--muted);
	font-size: 12px;
}

.dropdown__empty {
	padding: 10px;
	color: var(--muted);
	font-size: 14px;
}

.dropdown__error {
	color: var(--danger);
}
</style>
