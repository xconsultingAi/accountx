<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import * as auth from "../api/auth";
import { useSession } from "../stores/session";

const session = useSession();
const router = useRouter();
const route = useRoute();

const usr = ref("");
const pwd = ref("");
const otp = ref("");
const tmpId = ref("");
const otpPrompt = ref("");
const busy = ref(false);
const error = ref("");

async function finish(fullName: string): Promise<void> {
	const user = await auth.currentUser();
	if (!user) {
		// Signed in, but the cookie did not stick: the app is not on the same origin as
		// the API. Nothing the user can fix by retrying.
		error.value =
			"Signed in, but the browser did not keep the session. The app must be served from the same address as the ERPNext API (see the README).";
		return;
	}
	await session.enter(user, fullName);
	const next = typeof route.query.next === "string" && route.query.next.startsWith("/") ? route.query.next : "/";
	router.replace(next);
}

async function submit(): Promise<void> {
	if (busy.value) return;
	error.value = "";
	busy.value = true;
	try {
		const result = tmpId.value ? await auth.verifyOtp(tmpId.value, otp.value.trim()) : await auth.login(usr.value.trim(), pwd.value);
		if (result.status === "otp") {
			tmpId.value = result.tmpId;
			otpPrompt.value = result.prompt;
			return;
		}
		pwd.value = "";
		await finish(result.fullName);
	} catch (caught) {
		error.value = (caught as Error).message || "Sign-in failed.";
	} finally {
		busy.value = false;
	}
}

function restart(): void {
	tmpId.value = "";
	otp.value = "";
	error.value = "";
}
</script>

<template>
	<main class="login">
		<div class="login__brand">
			<img src="/icons/icon-192.png" alt="" width="64" height="64" />
			<h1>{{ session.companyName }} Accounts</h1>
			<p class="muted">Sign in with your ERPNext account</p>
		</div>

		<form class="card" @submit.prevent="submit">
			<div v-if="error" class="alert alert--error" role="alert">{{ error }}</div>

			<template v-if="!tmpId">
				<label class="field">
					<span>Email or username</span>
					<input v-model="usr" type="text" autocomplete="username" autocapitalize="off" inputmode="email" required />
				</label>
				<label class="field">
					<span>Password</span>
					<input v-model="pwd" type="password" autocomplete="current-password" required />
				</label>
			</template>

			<template v-else>
				<p>{{ otpPrompt }}</p>
				<label class="field">
					<span>Verification code</span>
					<input v-model="otp" type="text" inputmode="numeric" autocomplete="one-time-code" required />
				</label>
			</template>

			<button class="btn btn--primary btn--block" type="submit" :disabled="busy">
				{{ busy ? "Signing in…" : tmpId ? "Verify" : "Sign in" }}
			</button>
			<button v-if="tmpId" type="button" class="linkbtn small" style="margin-top: 12px" @click="restart">
				Use a different account
			</button>
		</form>
	</main>
</template>

<style scoped>
.login {
	max-width: 420px;
	margin: 0 auto;
	padding: 48px 16px 24px;
}

.login__brand {
	margin-bottom: 20px;
	text-align: center;
}

.login__brand img {
	border-radius: 16px;
	margin-bottom: 12px;
}
</style>
