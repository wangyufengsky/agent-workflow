import { type ModelSlotsDTO, ServerEventType } from '@aw/shared';
import type { EventBus } from '../../core/event-bus.ts';
import type { Logger } from '../../core/logger.ts';
import type { SettingsService } from '../settings/index.ts';

/** A request queued for a slot: `grant` starts it; it must count as in use before returning and must not throw. */
export type SlotWaiter = {
  id: string;
  grant: () => void;
  /** Its position changed (someone ahead was granted or left): republish what shows it. */
  moved: () => void;
};

export type ModelSlotsDeps = { settings: SettingsService; events: EventBus; log: Logger };

/**
 * One limit for every session that uses the model (D186): `scheduler.maxConcurrentAttempts`. Interactive work (someone
 * is waiting: the assistant, knowledge, PPT, Git workbench, breakdowns, team analyses) asks here and queues first come
 * first served; task planning and steps are dispatched by the scheduler within `backgroundLimit()`, which keeps one
 * slot free for interactive work and gives none while anything is queued. What is in use is counted when asked: a
 * session waiting for the user or for the model service (D163) holds no slot.
 */
export function createModelSlots({ settings, events, log }: ModelSlotsDeps) {
  /** Interactive sessions using the model, per owner (attempts, assistant turns). */
  const counters: Array<() => number> = [];
  /** Task planning and steps at work, as the scheduler last counted them. */
  let backgroundBusy = 0;
  const queue: SlotWaiter[] = [];
  let pendingDrain: NodeJS.Immediate | undefined;
  let disposed = false;
  let published: ModelSlotsDTO | undefined;

  const limit = () => settings.get('scheduler.maxConcurrentAttempts');
  const interactive = () => counters.reduce((sum, count) => sum + count(), 0);
  const hasRoom = () => interactive() + backgroundBusy < limit();

  function usage(): ModelSlotsDTO {
    return { inUse: interactive() + backgroundBusy, limit: limit(), queued: queue.length };
  }

  function publish(): void {
    const now = usage();
    if (published?.inUse === now.inUse && published.limit === now.limit && published.queued === now.queued) return;
    published = now;
    events.publish({ type: ServerEventType.ModelSlotsUpdated, data: now });
  }

  function drain(): void {
    let granted = 0;
    while (hasRoom()) {
      const next = queue.shift();
      if (next === undefined) break;
      granted += 1;
      log.debug({ id: next.id }, 'model slot granted');
      next.grant();
    }
    if (granted > 0) for (const waiter of queue) waiter.moved();
    publish();
  }

  /** Something may have freed or taken a slot: grant after the current change settles (grants start sessions). */
  function changed(): void {
    if (pendingDrain !== undefined || disposed) return;
    pendingDrain = setImmediate(() => {
      pendingDrain = undefined;
      drain();
    });
  }

  return {
    /** Registers an owner's count of interactive sessions using the model now. */
    addCounter(count: () => number): void {
      counters.push(count);
    },
    changed,
    /**
     * Interactive work asks for a slot: true when it may start now (it must then count as in use before the caller
     * yields); otherwise it waits in line and `grant` is called once a slot frees.
     */
    request(waiter: SlotWaiter): boolean {
      if (queue.length === 0 && hasRoom()) {
        changed();
        return true;
      }
      queue.push(waiter);
      publish();
      return false;
    },
    /** Leaves the line (stopped, deleted, the runtime went away); true when it was waiting. */
    cancel(id: string): boolean {
      const index = queue.findIndex((w) => w.id === id);
      if (index === -1) return false;
      queue.splice(index, 1);
      for (const waiter of queue.slice(index)) waiter.moved();
      publish();
      return true;
    },
    /** 1 = next in line; null when not waiting. */
    position(id: string): number | null {
      const index = queue.findIndex((w) => w.id === id);
      return index === -1 ? null : index + 1;
    },
    /** How many task sessions may be at work: one slot stays free for interactive work, none while it queues. */
    backgroundLimit(): number {
      if (queue.length > 0) return 0;
      const max = limit();
      return Math.min(max > 1 ? max - 1 : max, max - interactive());
    },
    setBackgroundBusy(count: number): void {
      if (count === backgroundBusy) return;
      backgroundBusy = count;
      changed();
    },
    /** Optional work (the companion's whisper) runs only when nothing waits and a slot is free. */
    isFree: (): boolean => queue.length === 0 && hasRoom(),
    usage,
    /** The app is closing: nothing more is granted, and no recount runs against the closed database. */
    dispose(): void {
      disposed = true;
      if (pendingDrain !== undefined) clearImmediate(pendingDrain);
      pendingDrain = undefined;
    },
  };
}
export type ModelSlots = ReturnType<typeof createModelSlots>;
