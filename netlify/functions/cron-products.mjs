/* netlify/functions/cron-products.mjs — 06:00 UTC, every day.
 *
 * Re-reads every shop and leaves a fresh copy of the feed at the edge, before
 * the price recorder runs at 08:20 and before anybody is shopping. The work is
 * done by cron-worker.mjs; this only starts it. See netlify/lib/cron.mjs.
 */
import { dispatch } from '../lib/cron.mjs';

export default async function cronProducts(request, context) {
  await dispatch('products-refresh', context);
}

/* Cron syntax, UTC. A literal: Netlify reads it from the source at build time. */
export const config = { schedule: '0 6 * * *' };
