import { ServerEventType } from '@aw/shared';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createEventBus } from '../../core/event-bus.ts';
import type { SettingsService } from '../settings/index.ts';
import { createModelSlots } from './model-slots.service.ts';

/** Slots with `limit` and an interactive count the test moves by hand. */
function setup(limit: number) {
  const events = createEventBus();
  const settings = { get: () => limit } as unknown as SettingsService;
  const slots = createModelSlots({ settings, events, log: pino({ level: 'silent' }) });
  const using = { count: 0 };
  slots.addCounter(() => using.count);
  const granted: string[] = [];
  const moved: string[] = [];
  const waiter = (id: string) => ({
    id,
    grant: () => {
      granted.push(id);
      using.count += 1;
    },
    moved: () => moved.push(id),
  });
  /** Frees one interactive slot and waits until the line moved. */
  const free = async () => {
    using.count -= 1;
    const settled = waitForEvent(events, ServerEventType.ModelSlotsUpdated, () => true);
    slots.changed();
    await settled;
  };
  return { slots, using, granted, moved, waiter, free };
}

describe('模型额度（D186）', () => {
  it('有空位时立即开始；用满后按先来后到排队，空出一个放行一个，后面的位置前移', async () => {
    const { slots, using, granted, moved, waiter, free } = setup(1);
    expect(slots.request(waiter('a'))).toBe(true);
    using.count = 1;
    expect(slots.request(waiter('b'))).toBe(false);
    expect(slots.request(waiter('c'))).toBe(false);
    expect([slots.position('b'), slots.position('c')]).toEqual([1, 2]);
    expect(slots.usage()).toEqual({ inUse: 1, limit: 1, queued: 2 });

    await free();
    expect(granted).toEqual(['b']);
    expect(moved).toEqual(['c']);
    expect([slots.position('b'), slots.position('c')]).toEqual([null, 1]);
    // Someone in line goes first even when a newcomer finds the slot free at that moment.
    using.count = 0;
    expect(slots.request(waiter('d'))).toBe(false);
    expect(slots.cancel('c')).toBe(true);
    expect(slots.position('d')).toBe(1);
  });

  it('任务最多用上限减一个，交互占用的不给任务；有请求排队时任务一个也不再开始', () => {
    const { slots, using, waiter } = setup(4);
    expect(slots.backgroundLimit()).toBe(3);
    using.count = 2;
    expect(slots.backgroundLimit()).toBe(2);
    slots.setBackgroundBusy(2);
    expect(slots.usage().inUse).toBe(4);
    expect(slots.request(waiter('a'))).toBe(false);
    expect(slots.backgroundLimit()).toBe(0);
    expect(slots.isFree()).toBe(false);
  });

  it('上限为 1 时任务也能用这一个', () => {
    const { slots } = setup(1);
    expect(slots.backgroundLimit()).toBe(1);
  });
});
