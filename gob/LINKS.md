# G.O.B. Founders Club: one link per channel

Every place you share the Founders Club gets **its own link**, so Shopify can tell you which
channel actually brings members in. Use the link for the place, and never one link everywhere.

This is the Crossroads Wedding Co. approach (`lib/lead-sources.ts` there): two signals, kept
side by side on purpose.

1. **What the link says.** The `utm_source` on each link below. It is reliable, but only for
   the doors you tagged.
2. **What the member says.** The "How did you find us?" choice on the join form, saved on
   the order as the line item property **Found us**. It catches the doors you did not tag
   (a friend saw your table), but people misremember.

Where the two agree, trust it. Where they disagree, the link wins for online channels and
the member wins for word of mouth.

## The links

| Channel | Where it goes | Link | QR code |
|---|---|---|---|
| `instagram-bio` | Instagram profile link | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=instagram-bio&utm_medium=social&utm_campaign=founders-launch |  |
| `instagram-story` | Link sticker on Instagram Stories | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=instagram-story&utm_medium=social&utm_campaign=founders-launch |  |
| `facebook` | Facebook posts and page button | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=facebook&utm_medium=social&utm_campaign=founders-launch |  |
| `email` | Every button in the launch email | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=email&utm_medium=email&utm_campaign=founders-launch |  |
| `text` | Texts and group chats | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=text&utm_medium=sms&utm_campaign=founders-launch |  |
| `table-sign` | The sign on your table at markets | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=table-sign&utm_medium=print&utm_campaign=founders-launch | `gob/print/links/qr-table-sign.svg` |
| `flyer` | Flyers and posters | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=flyer&utm_medium=print&utm_campaign=founders-launch | `gob/print/links/qr-flyer.svg` |
| `business-card` | Business cards | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=business-card&utm_medium=print&utm_campaign=founders-launch | `gob/print/links/qr-business-card.svg` |
| `popup-event` | Anything handed out at an event or launch night | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=popup-event&utm_medium=event&utm_campaign=founders-launch | `gob/print/links/qr-popup-event.svg` |
| `word-of-mouth` | When you send someone the link yourself | https://shop.legalleafmarket.shop/pages/founders-club?utm_source=word-of-mouth&utm_medium=referral&utm_campaign=founders-launch |  |

The counter card already has its own tag (`utm_source=counter-card`), made earlier.

**All printed QR codes were decoded with a QR reader** at full size and at 300 px and land
on the exact link in this table. Print them at least 1 in (2.5 cm) wide.

## Reading it in Shopify

- **Analytics > Reports > Sessions by referrer** (or "Sessions by UTM source", depending
  on your plan) shows visits per `utm_source`.
- **Analytics > Reports > Sales attributed to marketing** shows which source turned into
  orders. The campaign name on every link is `founders-launch`, so you can filter to it.
- **Orders:** open an order to see **Found us** under the item. To count them, export
  orders to CSV and filter the line item properties column.

## Rules

- **Add, never rename.** A tag that is printed on paper cannot be changed. If you need a new
  channel, add a new tag.
- **One tag per place.** If you use the table-sign link on a flyer, the flyer's members
  get counted as table-sign members and you can no longer tell which worked.
- Nothing here tracks a person. It counts which door they came in through.
