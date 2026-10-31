# Handoff to Claude in Chrome: Legal Leaf Market setup

You are taking over browser work for Legal Leaf Market. The owner is next to you and is the only person who enters personal or payment details, signs and submits. Work in a new tab, fill forms, and stop for the owner at every submit, payment or identity step.

**Master checklist (read first):** https://claude.ai/artifact/VommMLkYNZGKCe61tNoGtK
It has the pre-filled answers for the Articles of Organization and the EIN, fees, contacts, and attorney questions.

## Facts to use

| Item | Value |
|---|---|
| Legal name | Legal Leaf Market LLC |
| Trade name (DBA) | Legal-Leaf Market |
| State | Indiana |
| Business model | Online only, ships from Indiana, no storefront |
| What it sells | Smoking accessories: glass, pipes, bongs, grinders, papers, trays, storage, cleaning products. Plus affiliate links to partner stores. |
| What it does NOT sell | No flower of any kind, no vapes or vape batteries on Shopify, no nicotine or tobacco |
| Website | legal-leafmarket.com (code and hosting are handled in Claude Code; do not change them) |
| Management | Member-managed |

Ask the owner for: members and ownership split, business email, mailing address, and whether to use a paid registered agent (checklist recommends Northwest, $125/yr) or themselves.

## Tasks, in order

Do one at a time and check with the owner before each submit.

### 1. Indiana LLC (INBiz)
1. Open https://inbiz.in.gov, have the owner sign in with Access Indiana.
2. Run **Name Availability** for "Legal Leaf Market LLC".
3. Start **Articles of Organization** (domestic LLC) and fill it from the checklist's "Pre-filled answers for the Articles of Organization" table.
4. **Stop before payment** (about $75 plus processing). The owner reviews and pays.
5. Optional, same session: **Certificate of Assumed Business Name** for "Legal-Leaf Market" ($20 online). Owner pays.
6. Save the approved Articles PDF and tell the owner where it went.

### 2. EIN (only after the LLC is approved)
1. Go to **irs.gov → Apply for an EIN online**. Never use a site that charges a fee; only irs.gov is the real IRS.
2. Fill using the checklist's "Pre-filled answers for the IRS EIN application" table.
3. The **owner types their own SSN**. Do not read it back or store it anywhere.
4. On the final screen, have the owner **download the CP 575 PDF** immediately.

### 3. Indiana sales tax (after the EIN)
1. In INBiz, start the **Business Tax Application** for a Registered Retail Merchant Certificate (one location, $25).
2. Owner reviews and pays.

### 4. Shopify store
1. Create a store at shopify.com on the **Basic** plan, under the LLC's name. Keep the `*.myshopify.com` address for now.
2. Do **not** turn on Shopify Payments (it declines smoking accessories). Leave payments unset until step 5.
3. Install a **21+ age-verification app** that checks at checkout.
4. Settings → Taxes: enable Indiana sales tax (needs the RRMC number from step 3).
5. Settings → Shipping: US only. Leave the blocked-states list for the attorney.
6. Settings → Policies: copy the text from https://legal-leafmarket.com/shipping and https://legal-leafmarket.com/returns once they are live, or ask the owner.
7. Product wording rule: "for tobacco and legal herbs". No marijuana words, strain names or leaf imagery on accessory listings. Payment processors check this.
8. **No vape products** on Shopify (2026 reports say Shopify is removing them).

### 5. High-risk merchant account
1. Apply to **PaymentCloud** (https://paymentcloudinc.com/industries/smoking-accessories/) and **Soar Payments** (https://www.soarpay.com/industry/glassware).
2. Pre-fill business details only. The **owner enters SSN, ID and bank details** and submits.
3. They will want the Shopify store URL, so do step 4 first.
4. When approved, add their gateway (usually Authorize.net or NMI) in Shopify → Settings → Payments → third-party provider.

## Rules

- Never submit, pay, sign or agree to terms without the owner's explicit OK on that screen.
- Never type, copy or store an SSN, card number, bank login or password; the owner types those.
- Do not create accounts on any site except INBiz, IRS, Shopify and the two processors without asking.
- Flower: do not list, buy or research suppliers. It is on hold pending the attorney (checklist, "Bring these questions to the attorney consult").

## Hand back to Claude Code

When the Shopify store exists, give the owner a short note to paste back into the Claude Code session:

> Shopify store is up at `<name>.myshopify.com`. Merchant account: <approved / pending>. Products listed: <count>.

Claude Code will then connect the store to the site's shelf and cart, publish the Shipping and Returns pages, and update Terms and Privacy.
