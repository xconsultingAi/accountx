# accountx

A mobile web app (PWA) for **inayatco**'s accounts on ERPNext v16 (SaaS). It installs to the
home screen on Android and iOS and talks to ERPNext live. There is no local copy of the
books, so every figure on screen is current.

## What it does

| Area | Screens |
| --- | --- |
| **Receivable / payable** | Totals, overdue, ageing buckets (not due, 1-30, 31-60, 61-90, 90+), per-party balances, open invoices |
| **Ledgers** | General Ledger for an account, a customer or a supplier over any period, with opening, running and closing balance |
| **Payments** | Receive from customers and pay suppliers, either against one invoice or on account (settles the oldest invoices first, or records an advance) |
| **Journal entries** | Multi-line debits and credits, party on receivable/payable lines, live balance check, one-tap "Balance" |
| **Invoices** | Sales and purchase invoices with items, rates from the price list, optional tax template |
| **Documents** | Recent invoices, payments and journals; view, submit, cancel, download PDF, open in ERPNext |

Every create screen has **Save draft** and **Submit**. Submit saves and submits in one
request, so a failed submit never leaves a stray draft behind.

## How sign-in works (read before deploying)

Users sign in with their normal ERPNext email and password. Two-factor authentication is
supported if your site has it switched on. Each user sees and does exactly what their
ERPNext roles allow (typically *Accounts User* or *Accounts Manager*).

ERPNext's login cookie is `SameSite=Lax`, which browsers never send from a page on a
different domain. So the app **must be served from the same address as the ERPNext
API**. It always calls relative URLs (`/api/...`):

- **Development:** Vite's dev server forwards `/api`, `/files` and `/private` to your site.
- **Production:** a reverse proxy does the same. See `deploy/nginx.conf`.

If the app is hosted on a plain static host (Netlify, Vercel, GitHub Pages) without that
proxy, sign-in will appear to succeed and then immediately fail.

## Setup

```bash
cp .env.example .env
# edit .env:
#   ERP_URL=https://<your-site>.frappe.cloud   (or your ERPNext domain)
#   VITE_COMPANY=inayatco                      (exact Company name in ERPNext)
npm install
npm run dev          # http://localhost:5173
```

Use Chrome or Edge for local development. Safari refuses the ERPNext cookie on plain
`http://localhost`.

After sign-in the app checks that `VITE_COMPANY` exists and that the user can see it. If
not, it lists the companies the user *can* see, so the right name is easy to copy.

## Production

```bash
npm run build        # type-checks, then writes dist/
```

1. Copy `dist/` to the server (the nginx example uses `/var/www/accountx/dist`).
2. Put `deploy/nginx.conf` in place, replacing `accounts.example.com` and
   `inayatco.frappe.cloud` with your two domains, and add a TLS certificate. The PWA
   needs HTTPS to install.
3. Open the site on a phone and choose **Add to Home Screen** / **Install app**.

## Things to check in ERPNext

- **Mode of Payment:** each one used in the app needs a default account for inayatco
  (Mode of Payment > Accounts). Payments to a *Bank*-type account require a reference
  number and date, as in the desk.
- **Company default cost center:** it is applied to income and expense lines in journal
  entries.
- **Rate limiting:** behind the proxy, every user's login comes from the proxy's IP. If
  the site throttles logins by IP, ask your provider to trust `X-Forwarded-For` from the
  proxy.

## Limits

- **One currency.** Payments and journals assume the company currency. Foreign-currency
  parties are detected and sent to the ERPNext desk.
- **Up to 1,000 open invoices per side** on the receivable/payable screens. The screen
  says so if there are more.
- **Only the app shell works offline.** Data is never cached, so nothing can be entered
  offline.

## Development

```
src/
  api/        client.ts (HTTP + errors), auth.ts (login, 2FA), erp.ts (ERPNext calls)
  lib/        pure logic: ageing, journal checks, payment allocation, ledger parsing, invoices
  pages/      one file per screen
  components/ LinkField (ERPNext-style search), LedgerList, StatusTag
tests/        unit tests for everything in lib/
```

```bash
npm test             # unit tests
npm run typecheck
npm run icons        # regenerate the icons in public/icons (needs Python + Pillow)
```
