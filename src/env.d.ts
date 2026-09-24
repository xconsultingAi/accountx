/// <reference types="vite/client" />

declare const __ERP_DESK_URL__: string;

interface ImportMetaEnv {
	readonly VITE_COMPANY?: string;
}

declare module "*.vue" {
	import type { DefineComponent } from "vue";
	const component: DefineComponent<object, object, unknown>;
	export default component;
}
