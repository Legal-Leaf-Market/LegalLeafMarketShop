#!/usr/bin/env node
// Score an Impact.com marketplace export against the five sites in this family.
//
//   node tools/impact-scan.mjs impact_marketplace_brands.csv [--site LLM] [--csv out/]
//
// Zero dependencies, like everything else here. The export is a snapshot -- rates and
// programs change -- so this is a rerun-when-you-re-export tool, not a fixture. The
// shortlists in IMPACT_NETWORK.md were produced by it and hand-verified on top.
//
// Two things it deliberately does NOT do:
//   * decide eligibility. A cannabis-adjacent publisher is refused by many of these
//     advertisers regardless of fit; that is an application outcome, not a score.
//   * trust `domain`. 644 rows in the 11 Aug 2026 export carry an aggregator's domain
//     (ArtemisAds) rather than the brand's own, so the domain is evidence, not identity.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------- CSV
// Impact quotes any field containing a comma -- `category` always does -- so a split
// on ',' silently shreds every row. This is a real (small) RFC4180 reader.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// ---------------------------------------------------------------- payout
const CUR = { $: 'USD', 'US$': 'USD', '£': 'GBP', '€': 'EUR' };

// "15%" | "5%-30%" | "$10.00" | "$10.00,5%" | "EUR25.00" | "" | "0%"
export function parsePayout(raw) {
  const v = (raw || '').trim();
  if (!v) return { kind: 'none' };
  const pcts = [], flats = [];
  let currency = null;
  for (const part of v.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const nums = (p.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (p.includes('%')) pcts.push(...nums);
    else {
      const m = p.match(/^(US\$|[A-Z]{3}|[$£€])/);
      if (m) currency = CUR[m[1]] || m[1];
      flats.push(...nums);
    }
  }
  if (!pcts.length && !flats.length) return { kind: 'none' };
  return {
    kind: pcts.length && flats.length ? 'mixed' : (pcts.length ? 'pct' : 'flat'),
    pctMin: pcts.length ? Math.min(...pcts) : null,
    pctMax: pcts.length ? Math.max(...pcts) : null,
    flatMin: flats.length ? Math.min(...flats) : null,
    flatMax: flats.length ? Math.max(...flats) : null,
    currency,
  };
}

// ---------------------------------------------------------------- lexicons
// weight 6 = the site's core product, 4-5 = clearly sellable, 2-3 = cross-sell.
// A row needs at least one hit of weight >= 4 to score at all: the `category` column
// alone is never enough, because "Health & Beauty" covers 2,034 of the 10,326 rows.
//
// Every regex here is boundary-anchored where the bare token appears inside unrelated
// words. That is not fussiness -- the first pass matched `chai` against "chair" (six
// office-chair vendors ranked as tea), `pen\b` against "Open", and `doll` against
// "Dollar Car Rental".
const LEX = {
  LLM: [
    [/\bcbd\b|\bcbg\b|\bcbn\b|hemp|cannabi|\bthc\b|\bthca\b|delta.?[89]/i, 6, 'cannabinoid'],
    [/vaporiz|dry.?herb|\bdab\b|\bbong\b|\bpipe\b|grinder|rolling.?paper|smoke.?(shop|cartel)/i, 6, 'hardware'],
    [/terpene|kief|pre.?roll/i, 6, 'cannabis adjacent'],
    [/mushroom|shroom|amanita|adaptogen|nootropic/i, 3, 'functional/alt'],
    [/supplement|wellness|tincture/i, 2, 'wellness cross-sell'],
  ],
  HLM: [
    [/\btea\b|\bteas\b|\bchai\b|matcha|herbal.?(tea|infusion)|loose.?leaf|tisane|rooibos|oolong|pu.?erh/i, 6, 'tea'],
    [/kava|kratom|blue.?lotus|damiana|mullein|mugwort/i, 6, 'smokable botanical'],
    [/botanic|herbal|\bherbs?\b|apothecar|ayurved|adaptogen|tonic|elixir/i, 5, 'botanical'],
    [/mushroom|reishi|chaga|lion.?s.?mane|cordyceps/i, 5, 'functional mushroom'],
    [/incense|smudge|palo.?santo|censer/i, 4, 'ritual/incense'],
    [/\bcbd\b|\bcbg\b|hemp/i, 4, 'cannabinoid (HLM sells CBD/CBG)'],
    [/teaware|teapot|gaiwan/i, 3, 'tea accessory'],
  ],
  NM: [
    [/nicotine|\bsnus\b|nic.?salt|nicotine.?pouch/i, 6, 'nicotine'],
    [/\bvape\b|vaping|e.?liquid|e.?juice|atomizer|pod.?(kit|system)/i, 6, 'vape'],
    [/cigar|humidor|tobacco|cigarette|hookah|shisha/i, 6, 'cigar/tobacco'],
    [/lighter|torch|ashtray|cigar.?cutter/i, 3, 'accessory'],
  ],
  KK: [
    [/kawaii|anime|manga|otaku|chibi|sanrio|hello.?kitty|plushie|squish|amigurumi/i, 6, 'kawaii core'],
    [/\bjapan|nippon|tokyo|korea|k.?beauty|k.?pop|asian.?(beauty|snack)/i, 5, 'JP/KR'],
    [/cosplay|lolita|harajuku|\by2k\b|pastel/i, 5, 'cosplay/aesthetic'],
    [/sticker|stationer|washi|journal|planner|notebook|\bpens?\b|scrapbook/i, 4, 'stationery'],
    [/stuffed.?animal|\bdolls?\b|figurine|collectib|blind.?box|\btoys?\b/i, 4, 'toys/collectibles'],
    [/\bcute\b|charm|keychain|enamel.?pin|scrunchie/i, 3, 'cute accessory'],
    [/boba|bubble.?tea|snack.?box|mochi/i, 3, 'snacks'],
  ],
  GA: [
    [/guitar|luthier|fretboard|\bpedalboard\b/i, 6, 'guitar'],
    [/drum|percussion|cymbal|snare/i, 6, 'drums'],
    [/\bpiano\b|synth|\bmidi\b|sampler|groovebox/i, 6, 'keys/synth'],
    [/\baudio\b|studio.?monitor|preamp|microphone|\bmic\b|mixer|\bdaw\b|plugin|\bvst\b/i, 5, 'studio/audio'],
    [/music(al)?.?(instrument|supply|store|gear|arts)|\binstruments?\b/i, 5, 'music retail'],
    [/\bdj\b|turntable|serato|traktor/i, 5, 'DJ'],
    [/headphone|earbud|\biem\b|speaker|hi.?fi/i, 4, 'listening'],
    [/\bvinyl\b/i, 3, 'vinyl'],
  ],
};

// Tokens distinctive enough to trust glued inside a domain ("teaforguys", "slumbercbn").
// Short on purpose: 'amp' and a bare 'tea' are NOT here, because "example" and
// "steamworks" would score.
const GLUE = {
  LLM: /cannab|hemp|cbdm?|cbn|thca?|vape|grinder|bong/i,
  HLM: /matcha|herbal|botanic|mushroom|chaga|reishi|teashop|tealeaf/i,
  NM: /snus|nicotin|cigar|tobacco|vape(?!r?ware)/i,
  KK: /kawaii|sanrio|hellokitty|anime(?!d)|otaku|plush|squish|neko|kitty/i,
  GA: /guitar|synth|musicstore|pedalboard|audiostore/i,
};

// Each entry is a false positive an earlier pass actually produced, not a hypothetical.
const NEG = {
  LLM: /plushcare|telehealth|counseling/i,
  HLM: /\bsage\b|chair|massage|epoxy|bar.?b.?q|old.?smokey/i,
  NM: /ergopouch|baby|sleep.?(bag|sack)|swaddle|drink.?zyn|ticket|electrolyte|battlejuice|hyperlyte/i,
  KK: /plushcare|telehealth|hugo.?boss|payroll|babylist|plushbeds|sex.?toy|adult.?toy|lover.?doll|zelex|romp\.toys|glastoy|dollar|car.?rental|\bbank\b|dental|esim|lenovo|audible|prime.?video|easeus/i,
  GA: /wilson.?amplifier|signal.?boost|bass.?pro|cabela|pedal.?commander|pedal.?electric|midi.?health|tommy|hilfiger|gaming.?(mouse|keyboard)|rapoo|uperfect|fandiem|sweepstake/i,
};

const CAT = {
  LLM: { Pharmacy: 1, 'Health & Beauty': 1, 'Diet & Nutrition': 2, 'Organic & Eco-Friendly': 2 },
  HLM: { 'Food & Drink': 2, 'Food & Beverages': 2, Gourmet: 2, 'Diet & Nutrition': 2,
         'Organic & Eco-Friendly': 3, Pharmacy: 1, 'Health & Beauty': 1 },
  NM: { 'Consumer Electronics': 1, 'Gifts & Stationery': 1 },
  KK: { 'Kids & Toys': 3, 'Games/Toys': 3, Gifts: 2, 'Gifts & Stationery': 3,
        'Jewelry & Watches': 2, 'Cosmetics & Skin Care': 2, 'Womens Apparel': 2,
        'Art & Craft Supplies': 2, 'Collectibles & Hobbies': 2 },
  GA: { 'Movies & Music': 4, 'Art & Entertainment': 2, 'Consumer Electronics': 2,
        'Computers & Electronics': 1, Software: 1 },
};

// Vendors each site already carries. A hit is not a new store -- it is the chance to
// put an existing untracked handoff onto tracked links.
const VENDORS = {
  LLM: /thcasmallbuds|thca4cheap|blacktiecbd|hipuffy|thcahempire|dsquaredworldwide|binoidcbd|bloomzhemp|cbdhemp|exhalewell|nothingbutcanna|hitoki|yllvape|zamgrinders|grasscity|greekglassshop/i,
  HLM: /puffherbals|secretnature|mysoulcbd|charlottesweb|rishi-tea/i,
  NM: /snusoclock|europesnus|nicokick|nikopouches|blackbuffalo|eightvape|vaporesso|geekvape|freemaxvape|relxvape|monterocigars|beardcigars|jakesmintchew|snusbb|bruscocigars|onestoppipeshop|3avape|bimovape/i,
  KK: /plushible|korekawaii|hellokittycamp|stopshop9|autoplush|montessoriandme|mintielunchboxes|jigsawdepot|brkox/i,
  GA: /andertons/i,
};

const JUNK = /insurance|mortgage|\bloans?\b|payroll|legal.?service|attorney|banking|credit.?card|staffing|recruit|web.?host|\bvpn\b|antivirus|casino|betting|dating|real.?estate|solar|roofing|timeshare|forex/i;
const AGGREGATOR = /artemisads\.com|impact\.com|^n\/a$/i;

const normDomain = (d) => (d || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');

function variantOf(name) {
  const n = name.toLowerCase();
  if (n.includes('amazon seller') || n.includes('amazon')) return 'amazon-seller';
  if (n.includes('creator') || n.includes('influencer')) return 'creator';
  if (n.includes('performance')) return 'performance';
  return 'standard';
}

export function scoreRow(r, site) {
  const name = (r.name || '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const domain = normDomain(r.domain);
  const hay = `${name} ${domain} ${r.landingPage || ''}`;
  if (NEG[site].test(hay)) return null;

  let score = 0, core = false;
  const reasons = [];
  for (const [rx, w, note] of LEX[site]) {
    if (rx.test(hay)) { score += w; reasons.push(note); if (w >= 4) core = true; }
  }
  if (GLUE[site].test(domain.replace(/\./g, ''))) {
    score += 5; core = true; reasons.push('domain token');
  }
  if (!core) return null;

  const cats = (r.category || '').split(',').map((c) => c.trim()).filter(Boolean);
  const catScore = Math.min(cats.reduce((a, c) => a + (CAT[site][c] || 0), 0), 6);
  if (catScore) { score += catScore; reasons.push(`cat+${catScore}`); }
  if (JUNK.test(hay)) score -= 8;
  if (score < 4) return null;

  const pay = parsePayout(r.payoutValue);
  const rate = pay.pctMax ?? pay.pctMin ?? null;
  const bonus = rate != null ? (rate >= 20 ? 2 : rate >= 12 ? 1 : 0) : (pay.flatMax ? 1 : 0);

  return {
    site, fit: score, total: score + bonus, id: r.id, name, domain,
    payout: r.payoutValue, payoutLabel: r.payoutLabel, ...pay,
    variant: variantOf(name),
    alreadyVendor: VENDORS[site].test(domain),
    aggregatorDomain: AGGREGATOR.test(domain),
    category: cats.join('; '),
    reasons: [...new Set(reasons)].sort().join(', '),
  };
}

// ---------------------------------------------------------------- main
function main(argv) {
  const src = argv.find((a) => !a.startsWith('--'));
  if (!src) {
    console.error('usage: node tools/impact-scan.mjs <export.csv> [--site LLM] [--csv out/]');
    process.exit(2);
  }
  const only = argv.includes('--site') ? argv[argv.indexOf('--site') + 1] : null;
  const outDir = argv.includes('--csv') ? argv[argv.indexOf('--csv') + 1] : null;

  const rows = parseCsv(readFileSync(src, 'utf8'));
  const sites = only ? [only] : Object.keys(LEX);
  if (outDir) mkdirSync(outDir, { recursive: true });

  for (const site of sites) {
    const hits = rows.map((r) => scoreRow(r, site)).filter(Boolean)
      .sort((a, b) => b.total - a.total || (b.pctMax ?? 0) - (a.pctMax ?? 0)
        || a.name.localeCompare(b.name));
    const merchants = new Set(hits.filter((h) => !h.aggregatorDomain).map((h) => h.domain));
    console.log(`\n${site}  ${hits.length} candidate programs / ${merchants.size} merchants`
      + `  (${hits.filter((h) => (h.pctMax ?? 0) >= 20).length} at 20%+)`);
    for (const h of hits.slice(0, 20)) {
      console.log(`  ${String(h.total).padStart(3)} ${h.alreadyVendor ? '*' : ' '} `
        + `${h.name.slice(0, 38).padEnd(38)} ${h.domain.slice(0, 26).padEnd(26)} `
        + `${(h.payout || '--').padEnd(11)} ${h.reasons}`);
    }
    if (outDir) {
      const cols = ['total', 'fit', 'alreadyVendor', 'name', 'domain', 'payout',
        'payoutLabel', 'pctMin', 'pctMax', 'flatMax', 'currency', 'variant',
        'aggregatorDomain', 'reasons', 'category', 'id'];
      const esc = (v) => {
        const s = v == null ? '' : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      writeFileSync(join(outDir, `${site}.csv`),
        [cols.join(','), ...hits.map((h) => cols.map((c) => esc(h[c])).join(','))].join('\n'));
    }
  }
  console.log('\n* = already a vendor on that site; the program is the tracked-link upgrade.');
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
