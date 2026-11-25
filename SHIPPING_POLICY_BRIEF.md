# Brief: read three shops' shipping policies (for Claude in Chrome)

The dispensary shelf on shop.legalleafmarket.shop can now hide products a partner shop will not
ship to the shopper's state (`SHIPPING` in `public/shop-dispensary.js`). It hides nothing until
each shop's own published policy has been read. Read these three and bring back the block below.

| Shop | Where to look first |
| --- | --- |
| THCA Small Buds | https://thcasmallbuds.com/policies/shipping-policy, then their FAQ |
| Puffweiser Store | puffweiserstore.com: the footer's Shipping or Shipping Policy page, then FAQ |
| Black Tie CBD | https://www.blacktiecbd.net/policies/shipping-policy, then their FAQ |

## Rules

- Only what the shop's own pages say. Not a forum, not a review site, not a guess.
- Note separately: states they ship nothing to, and states they will not send THCa products to.
- If the policy is vague ("we cannot ship to states where prohibited"), say so: that is not a list.
- Do not buy anything, create an account, or start a checkout.

## Return this, one block per shop

```
shop: thcasmallbuds
never: CA, NV
thca: ID
source: <exact URL read>
checked: 2026-11-25
quote: <the sentence(s) the list came from, copied exactly>
```

Paste the three blocks back into Claude Code; filling in `SHIPPING` is a data edit and a jsDelivr pin.
