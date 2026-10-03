/* netlify/functions/cron-worker.mjs — does the nightly work. See netlify/lib/cron.mjs.
 *
 * A background function: the caller gets 202 at once and this runs for up to
 * fifteen minutes. Reached only by the two scheduled functions beside it, which
 * present CRON_SECRET; anything else is refused and logged.
 */
import { prepare } from '../lib/runtime.mjs';
import { work } from '../lib/cron.mjs';

export default async function cronWorker(request, context) {
  prepare();
  await work(request, context);
}

export const config = { background: true };
