#!/usr/bin/env node
// lume-overlap.mjs — how much of the live catalogue could a mood filter actually speak for?
//
// WHY THIS EXISTS
//
// LUME_INTEGRATION.md proposes joining Lume's mood vocabulary to this site's catalogue on the
// strain name. Whether that is a feature or a decoration comes down to one number nobody has
// measured: of the ~6,000 products /api/products returns, how many carry a strain Lume has an
// opinion about? Lume's library is 24 canonical strains; this catalogue is dominated by novel
// THCa crosses (John Truffolta, Apple Jacks, 9 LB Hammer, Dank Toad — all real rows, named in
// products.js and BUDTENDER_PLAN.md). If the answer is "forty products", a mood filter is a
// page that mostly says "nothing matches", and the vocabulary has to be WRITTEN for the strains
// we actually sell rather than imported from Lume.
//
// It could not be measured where it was written: egress to legal-leafmarket.com is refused by
// that container's proxy. So this is the one command that answers it, from anywhere with
// network, and it also runs against a saved feed so the answer can be re-checked offline.
//
//   node lume-overlap.mjs                          # live feed
//   node lume-overlap.mjs --feed ./products.json   # a saved response
//   node lume-overlap.mjs --json                   # machine-readable, for diffing over time
//
// IT DOES NOT DEFINE ITS OWN NORMALISER. The strain key comes from api/products.js's own
// LAB_NOISE, read out of the source at runtime. That regex is 40-odd grade and size tokens and
// CLAUDE.md is explicit that a token it misses splits one strain into two keys; a second copy
// here would drift from it silently, which is the failure mode this repo keeps paying for
// (four copies of storeCheckoutUrl, _OV_FIELDS in two places). Read it, never restate it.

import { readFile } from 'node:fs/promises';

const FEED = 'https://legal-leafmarket.com/api/products';

/* Lume's offline fallback library, lifted verbatim from lume.garden's page source (the
   `const STRAINS=[...]` its client falls back to when its own /api is unreachable), minus the
   prose fields this probe has no use for. A SNAPSHOT for measuring coverage — not a source of
   truth, and not this site's data. Lume's own /api is authoritative for Lume. */
const LUME = [
  {"slug": "blue-dream", "name": "Blue Dream", "type": "Hybrid", "terpene": "Myrcene", "moods": ["Elevate", "Unwind"], "flavors": ["Sweet", "Herbal"]},
  {"slug": "og-kush", "name": "OG Kush", "type": "Hybrid", "terpene": "Myrcene", "moods": ["Unwind", "Elevate"], "flavors": ["Earthy", "Spicy"]},
  {"slug": "sour-diesel", "name": "Sour Diesel", "type": "Sativa", "terpene": "Limonene", "moods": ["Elevate", "Focus"], "flavors": ["Spicy", "Citrus"]},
  {"slug": "granddaddy-purple", "name": "Granddaddy Purple", "type": "Indica", "terpene": "Myrcene", "moods": ["Drift off", "Unwind"], "flavors": ["Sweet", "Earthy"]},
  {"slug": "northern-lights", "name": "Northern Lights", "type": "Indica", "terpene": "Caryophyllene", "moods": ["Drift off", "Unwind"], "flavors": ["Earthy", "Spicy"]},
  {"slug": "jack-herer", "name": "Jack Herer", "type": "Sativa", "terpene": "Terpinolene", "moods": ["Focus", "Elevate"], "flavors": ["Herbal", "Spicy"]},
  {"slug": "girl-scout-cookies", "name": "Girl Scout Cookies", "type": "Hybrid", "terpene": "Caryophyllene", "moods": ["Unwind", "Elevate"], "flavors": ["Sweet", "Earthy"]},
  {"slug": "wedding-cake", "name": "Wedding Cake", "type": "Hybrid", "terpene": "Limonene", "moods": ["Unwind", "Drift off"], "flavors": ["Sweet", "Earthy"]},
  {"slug": "gg4", "name": "GG4 (Original Glue)", "type": "Hybrid", "terpene": "Caryophyllene", "moods": ["Unwind", "Drift off"], "flavors": ["Earthy", "Spicy"]},
  {"slug": "green-crack", "name": "Green Crack", "type": "Sativa", "terpene": "Myrcene", "moods": ["Elevate", "Focus"], "flavors": ["Citrus", "Sweet"]},
  {"slug": "durban-poison", "name": "Durban Poison", "type": "Sativa", "terpene": "Terpinolene", "moods": ["Focus", "Elevate"], "flavors": ["Herbal", "Sweet"]},
  {"slug": "pineapple-express", "name": "Pineapple Express", "type": "Hybrid", "terpene": "Caryophyllene", "moods": ["Elevate", "Focus"], "flavors": ["Sweet", "Citrus"]},
  {"slug": "bubba-kush", "name": "Bubba Kush", "type": "Indica", "terpene": "Caryophyllene", "moods": ["Drift off", "Unwind"], "flavors": ["Earthy", "Sweet"]},
  {"slug": "super-lemon-haze", "name": "Super Lemon Haze", "type": "Sativa", "terpene": "Terpinolene", "moods": ["Elevate", "Focus"], "flavors": ["Citrus", "Sweet"]},
  {"slug": "white-widow", "name": "White Widow", "type": "Hybrid", "terpene": "Myrcene", "moods": ["Elevate", "Unwind"], "flavors": ["Earthy", "Herbal"]},
  {"slug": "zkittlez", "name": "Zkittlez", "type": "Indica", "terpene": "Caryophyllene", "moods": ["Unwind", "Drift off"], "flavors": ["Sweet", "Citrus"]},
  {"slug": "runtz", "name": "Runtz", "type": "Hybrid", "terpene": "Limonene", "moods": ["Elevate", "Unwind"], "flavors": ["Sweet", "Citrus"]},
  {"slug": "do-si-dos", "name": "Do-Si-Dos", "type": "Indica", "terpene": "Limonene", "moods": ["Drift off", "Unwind"], "flavors": ["Sweet", "Floral"]},
  {"slug": "ak-47", "name": "AK-47", "type": "Hybrid", "terpene": "Myrcene", "moods": ["Elevate", "Focus"], "flavors": ["Earthy", "Floral"]},
  {"slug": "purple-punch", "name": "Purple Punch", "type": "Indica", "terpene": "Caryophyllene", "moods": ["Drift off", "Unwind"], "flavors": ["Sweet", "Floral"]},
  {"slug": "strawberry-cough", "name": "Strawberry Cough", "type": "Sativa", "terpene": "Myrcene", "moods": ["Elevate", "Focus"], "flavors": ["Sweet", "Herbal"]},
  {"slug": "gelato", "name": "Gelato", "type": "Hybrid", "terpene": "Caryophyllene", "moods": ["Unwind", "Elevate"], "flavors": ["Sweet", "Citrus"]},
  {"slug": "trainwreck", "name": "Trainwreck", "type": "Sativa", "terpene": "Terpinolene", "moods": ["Focus", "Elevate"], "flavors": ["Citrus", "Spicy"]},
  {"slug": "super-silver-haze", "name": "Super Silver Haze", "type": "Sativa", "terpene": "Terpinolene", "moods": ["Elevate", "Focus"], "flavors": ["Citrus", "Herbal"]}
];

/* Aliases the strain key cannot bridge on its own, because they are different WORDS for the
   same cultivar rather than the same words punctuated differently. Every one of these is a
   real trade name; a join without them undercounts, and undercounting here argues against a
   feature that might be fine. Deliberately short: only names in wide, unambiguous use.
   `glue` alone is NOT here — it appears in unrelated titles. */
const ALIASES = {
  'gg4': ['gg4', 'gg 4', 'original glue', 'gorilla glue', 'gorilla glue 4'],
  'girl-scout-cookies': ['girl scout cookies', 'gsc'],
  'granddaddy-purple': ['granddaddy purple', 'grand daddy purple', 'gdp', 'granddaddy purp'],
  'do-si-dos': ['do si dos', 'dosi dos', 'dosidos', 'dosi'],
  'ak-47': ['ak 47', 'ak47'],
  'super-lemon-haze': ['super lemon haze', 'lemon haze'],
  'zkittlez': ['zkittlez', 'zkittles', 'skittlez'],
  'northern-lights': ['northern lights', 'northern light']
};

function args() {
  const a = process.argv.slice(2), o = { feed: FEED, json: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--feed') o.feed = a[++i];
    else if (a[i] === '--json') o.json = true;
    else if (a[i] === '--help' || a[i] === '-h') o.help = true;
    else { console.error('unknown argument: ' + a[i]); process.exit(2); }
  }
  return o;
}

// The repo's own LAB_NOISE, read from source. Never restated here — see the header.
async function labStrainKeyFromSource() {
  const src = await readFile(new URL('./api/products.js', import.meta.url), 'utf8');
  const m = src.match(/^const LAB_NOISE = (\/.+\/)([a-z]*);$/m);
  if (!m) throw new Error('LAB_NOISE not found in api/products.js — did it move or change shape? '
    + 'Fix this probe to read the new declaration rather than copying the regex in.');
  const flags = m[2].includes('g') ? m[2] : m[2] + 'g';
  const body = m[1].slice(1, -1);
  return (name) => String(name || '')
    .replace(new RegExp(body, flags), ' ')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).join(' ');
}

async function loadFeed(where) {
  if (/^https?:\/\//.test(where)) {
    const res = await fetch(where, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('feed ' + where + ' -> HTTP ' + res.status);
    return res.json();
  }
  return JSON.parse(await readFile(where, 'utf8'));
}

// Whole-word containment in either direction: catalogue titles carry the strain plus words
// LAB_NOISE does not know ("Candy Paint Exotic THCA"), and Lume's own keys are sometimes the
// longer string ("gg4 original glue"). Substring alone would match "ak 47" inside "black ak 47"
// legitimately but also "runtz" inside "runtzberry", so the run has to fall on word boundaries.
function holds(hay, needle) {
  if (!hay || !needle) return false;
  if (hay === needle) return true;
  const h = ' ' + hay + ' ', n = ' ' + needle + ' ';
  return h.includes(n);
}

function money(n) { return n == null ? '—' : '$' + Number(n).toFixed(2); }

async function main() {
  const o = args();
  if (o.help) {
    console.log('usage: node lume-overlap.mjs [--feed <url|path>] [--json]');
    return;
  }
  const key = await labStrainKeyFromSource();
  const feed = await loadFeed(o.feed);
  const products = Array.isArray(feed) ? feed : (feed.products || []);
  if (!products.length) throw new Error('feed carried no products — wrong shape, or a cold '
    + '/api/products that returned an error body');

  // Normalise once. Flower is the only category a strain name means anything for; a grinder
  // called "Zkittlez" would inflate the count for a mood page that intends to sell flower.
  const rows = products.map(p => ({
    name: p.name, key: key(p.name), store: p.store, storeKey: p.storeKey,
    cannabinoid: p.cannabinoid, category: p.category, type: p.type,
    perG: p.perG, startsAt: p.startsAt, lab: !!p.lab, coa: !!p.coa
  }));
  const isFlower = r => /flower/i.test(r.category || '') || /flower/i.test(r.name || '');
  const flower = rows.filter(isFlower);

  const hit = new Map();          // lume slug -> matching rows
  const claimed = new Set();      // product indices any lume strain speaks for
  LUME.forEach(s => {
    const needles = ALIASES[s.slug] || [key(s.name)];
    const mine = [];
    flower.forEach((r, i) => {
      if (needles.some(n => holds(r.key, key(n)) || holds(key(n), r.key))) { mine.push(r); claimed.add(i); }
    });
    hit.set(s.slug, mine);
  });

  // The reverse question, and the more important one: which strains does the catalogue actually
  // sell that Lume has nothing to say about? Those are the rows a mood filter leaves dark, and
  // the vocabulary that would have to be written. Ranked by how many products ride on each key.
  const dark = new Map();
  flower.forEach((r, i) => {
    if (claimed.has(i) || !r.key) return;
    let d = dark.get(r.key); if (!d) { d = []; dark.set(r.key, d); }
    d.push(r);
  });
  const darkRanked = [...dark.entries()].sort((a, b) => b[1].length - a[1].length);

  const covered = [...claimed].length;
  const withRows = LUME.filter(s => hit.get(s.slug).length);
  const out = {
    feed: o.feed,
    updated: feed && feed.meta ? feed.meta.updated : null,
    products: products.length,
    flower: flower.length,
    lumeStrains: LUME.length,
    lumeStrainsWithStock: withRows.length,
    flowerCovered: covered,
    flowerCoveredPct: flower.length ? Math.round(covered / flower.length * 1000) / 10 : 0,
    darkStrainKeys: darkRanked.length,
    byStrain: LUME.map(s => {
      const m = hit.get(s.slug);
      const cheapest = m.filter(r => r.perG != null).sort((a, b) => a.perG - b.perG)[0] || null;
      return {
        slug: s.slug, moods: s.moods, products: m.length,
        stores: [...new Set(m.map(r => r.store))].length,
        cheapestPerG: cheapest ? cheapest.perG : null,
        cheapestStore: cheapest ? cheapest.store : null,
        anyLab: m.some(r => r.lab)
      };
    }),
    topDark: darkRanked.slice(0, 40).map(([k, v]) => ({ key: k, products: v.length, example: v[0].name }))
  };

  if (o.json) { console.log(JSON.stringify(out, null, 2)); return; }

  console.log('feed          ' + out.feed + (out.updated ? '  (updated ' + out.updated + ')' : ''));
  console.log('products      ' + out.products + ', of which flower ' + out.flower);
  console.log('lume library  ' + out.lumeStrains + ' strains, ' + out.lumeStrainsWithStock + ' with any flower in stock');
  console.log('coverage      ' + out.flowerCovered + ' / ' + out.flower + ' flower products (' + out.flowerCoveredPct + '%)');
  console.log('unspoken for  ' + out.darkStrainKeys + ' distinct strain keys the catalogue sells and Lume has no entry for');
  console.log('');
  console.log('per strain (moods · products · stores · cheapest per g · any parsed COA)');
  out.byStrain.forEach(b => {
    console.log('  ' + b.slug.padEnd(20) + String(b.products).padStart(4)
      + '  ' + String(b.stores).padStart(2) + ' store(s)'
      + '  ' + money(b.cheapestPerG).padStart(8) + '/g'
      + (b.cheapestStore ? '  ' + b.cheapestStore : '')
      + (b.anyLab ? '  [lab]' : '')
      + '   ' + b.moods.join('/'));
  });
  console.log('');
  console.log('biggest strains with NO Lume entry — the vocabulary a mood page would need written:');
  out.topDark.forEach(d => console.log('  ' + String(d.products).padStart(4) + '  ' + d.key + '   e.g. ' + d.example));
  console.log('');
  console.log('Read it this way: coverage is the ceiling on a Lume-vocabulary mood filter, and the');
  console.log('dark list is the work to raise it. Aliases in ALIASES are the only name-bridging done;');
  console.log('a strain reading 0 may be genuinely absent or may be sold here under another name.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
