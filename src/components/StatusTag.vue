<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ status?: string | null; docstatus?: number }>();

const label = computed(() => {
	if (props.docstatus === 0) return "Draft";
	if (props.docstatus === 2) return "Cancelled";
	return props.status || "Submitted";
});

const tone = computed(() => `tag--${label.value.toLowerCase().replace(/\s+/g, "-")}`);
</script>

<template>
	<span class="tag" :class="tone">{{ label }}</span>
</template>
