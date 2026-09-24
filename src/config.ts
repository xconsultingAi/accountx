/** Build-time settings. See .env.example. */
export const COMPANY = (import.meta.env.VITE_COMPANY || "inayatco").trim();

/** Where "Open in ERPNext" links go. Empty when not configured. */
export const ERP_DESK_URL = (typeof __ERP_DESK_URL__ === "string" ? __ERP_DESK_URL__ : "").replace(/\/+$/, "");
