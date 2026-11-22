import type { FastifyBaseLogger } from 'fastify';
import { dateIn } from '@taskboard/shared';
import type { Store } from '../store';

/**
 * Rolls unfinished cards from past days onto today: once at start-up, then whenever the
 * date changes in `timeZone`. Checking each minute rather than sleeping until midnight
 * copes with clock changes and with the machine waking from sleep.
 */
export function startRollover(store: Store, timeZone: string, log: FastifyBaseLogger, everyMs = 60_000) {
  let lastDay: string | null = null;
  let running = false;

  const tick = async () => {
    const today = dateIn(timeZone);
    if (today === lastDay || running) return;
    running = true;
    try {
      const moved = await store.rollOver(today);
      lastDay = today;
      if (moved.length) log.info({ today, cards: moved.map((c) => c.ref) }, 'Carried unfinished cards over to today');
    } catch (err) {
      log.error({ err }, 'Roll-over failed; trying again in a minute');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, everyMs);
  timer.unref();
  const first = tick();
  return {
    /** Resolves once the start-up roll-over has finished. */
    ready: first,
    async stop() {
      clearInterval(timer);
      await first;
    },
  };
}
