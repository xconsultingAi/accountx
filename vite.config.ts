/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The app talks to ERPNext through relative `/api/...` URLs, always.
 *
 * ERPNext's session cookie is `SameSite=Lax`, so a browser will not send it from a page
 * on another domain. Serving the app and the API from one origin is the only way a
 * username + password session works: here the dev server proxies to the SaaS site, and in
 * production a reverse proxy does the same (see deploy/nginx.conf).
 */
export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const erpUrl = (env.ERP_URL || "").replace(/\/+$/, "");

	const proxied = ["/api", "/files", "/private"];
	const proxy = erpUrl
		? Object.fromEntries(
				proxied.map((path) => [
					path,
					{
						target: erpUrl,
						changeOrigin: true,
						secure: true,
						// Frappe sets no Domain on its cookies, but strip one if a proxy adds it,
						// so the cookie binds to localhost.
						cookieDomainRewrite: "",
					},
				])
			)
		: undefined;

	return {
		define: {
			__ERP_DESK_URL__: JSON.stringify(env.VITE_ERP_DESK_URL || erpUrl),
		},
		build: {
			// Not "assets": that path belongs to Frappe, and the production proxy should
			// never have to decide which of the two a request meant.
			assetsDir: "static",
		},
		server: { proxy },
		preview: { proxy },
		plugins: [
			vue(),
			VitePWA({
				registerType: "autoUpdate",
				includeAssets: ["icons/favicon.svg", "icons/apple-touch-icon.png"],
				manifest: {
					name: "inayatco Accounts",
					short_name: "Accounts",
					description: "Receivables, payables, payments and journals for inayatco",
					theme_color: "#0f766e",
					background_color: "#f6f7f9",
					display: "standalone",
					orientation: "portrait",
					start_url: "/",
					scope: "/",
					icons: [
						{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
						{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
						{ src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
					],
				},
				workbox: {
					// Only the app shell is cached. Financial data is always fetched live, so
					// nobody acts on a stale balance.
					globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
					navigateFallback: "/index.html",
					navigateFallbackDenylist: [/^\/api\//, /^\/files\//, /^\/private\//, /^\/app\//],
				},
			}),
		],
		test: {
			environment: "node",
			include: ["tests/**/*.test.ts"],
		},
	};
});
