import { createApp } from "vue";
import { createPinia } from "pinia";
import { registerSW } from "virtual:pwa-register";

import App from "./App.vue";
import { router } from "./router";
import "./styles.css";

createApp(App).use(createPinia()).use(router).mount("#app");

// A new build activates on the next launch; nothing to prompt for in an accounting app
// where every figure is fetched live anyway.
registerSW({ immediate: true });
