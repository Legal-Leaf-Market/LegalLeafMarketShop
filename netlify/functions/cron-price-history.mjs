/* netlify/functions/cron-price-history.mjs — 08:20 UTC, every day.
 *
 * Folds today's shelf into the "cheapest we've seen" record. This is the one
 * job here where waiting destroys value: there is no backfill, so a night that
 * is not recorded is gone (CLAUDE.md §10). The work is done by cron-worker.mjs;
 * this only starts it. See netlify/lib/cron.mjs.
 *
 * AFTER the 06:00 refresh, deliberately: the recorder prices the catalogue that
 * refresh leaves behind. test-price-history.mjs holds the order.
 */
import { dispatch } from '../lib/cron.mjs';

export default async function cronPriceHistory(request, context) {
  await dispatch('price-history', context);
}

/* Cron syntax, UTC. A literal: Netlify reads it from the source at build time. */
export const config = { schedule: '20 8 * * *' };
