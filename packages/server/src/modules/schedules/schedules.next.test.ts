import { type ScheduleFrequency, scheduleFrequencySchema } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { foldDueTimes, nextRunAfter } from './schedules.next.ts';

const SHANGHAI = 'Asia/Shanghai';
const NEW_YORK = 'America/New_York';
const at = (iso: string) => Date.parse(iso);
const next = (frequency: ScheduleFrequency, after: string, zone = SHANGHAI) =>
  new Date(nextRunAfter(frequency, at(after), zone)).toISOString();

describe('nextRunAfter', () => {
  it('每天：当天的时刻没过就是今天，过了（或正好是）就是明天', () => {
    const daily = { kind: 'daily', time: '02:00' } as const;
    // 2026-10-21 01:00 Shanghai = 2026-10-20T17:00Z
    expect(next(daily, '2026-10-20T17:00:00Z')).toBe('2026-10-20T18:00:00.000Z');
    expect(next(daily, '2026-10-20T18:00:00Z')).toBe('2026-10-21T18:00:00.000Z');
  });

  it('每周：选定的几天里最近的一天，跨周回到第一天', () => {
    // Monday and Wednesday 09:00; 2026-10-22 is a Thursday.
    const weekly: ScheduleFrequency = { kind: 'weekly', weekdays: [1, 3], time: '09:00' };
    expect(next(weekly, '2026-10-22T03:00:00Z')).toBe('2026-10-26T01:00:00.000Z');
    expect(next(weekly, '2026-10-26T01:00:00Z')).toBe('2026-10-28T01:00:00.000Z');
  });

  it('每 N 小时：从起始时刻按 N 小时循环，跨过午夜', () => {
    const hourly = { kind: 'hourly', everyHours: 6, time: '20:30' } as const;
    // Runs at 02:30, 08:30, 14:30, 20:30 Shanghai; 2026-10-21 21:00 Shanghai → 02:30 next day.
    expect(next(hourly, '2026-10-21T13:00:00Z')).toBe('2026-10-21T18:30:00.000Z');
    expect(next(hourly, '2026-10-21T18:30:00Z')).toBe('2026-10-22T00:30:00.000Z');
  });

  it('夏令时开始当天，被跳过的时刻顺延到切换之后', () => {
    // New York skips 02:00–03:00 on 2026-03-08; 02:30 becomes 03:30 EDT (07:30Z).
    const daily = { kind: 'daily', time: '02:30' } as const;
    expect(next(daily, '2026-03-08T05:00:00Z', NEW_YORK)).toBe('2026-03-08T07:30:00.000Z');
    // The next day is back to 02:30 EDT.
    expect(next(daily, '2026-03-08T07:30:00Z', NEW_YORK)).toBe('2026-03-09T06:30:00.000Z');
  });

  it('夏令时结束当天，重复的时刻只运行一次', () => {
    // New York shows 01:00–02:00 twice on 2026-11-01; 01:30 runs at its first occurrence (EDT, 05:30Z) only.
    const daily = { kind: 'daily', time: '01:30' } as const;
    expect(next(daily, '2026-11-01T04:00:00Z', NEW_YORK)).toBe('2026-11-01T05:30:00.000Z');
    expect(next(daily, '2026-11-01T05:30:00Z', NEW_YORK)).toBe('2026-11-02T06:30:00.000Z');
  });
});

describe('foldDueTimes', () => {
  it('错过的多个时刻折叠为最后一个，其余记为错过', () => {
    const daily = { kind: 'daily', time: '02:00' } as const;
    // Due 10-21 02:00 Shanghai; it is now 10-24 09:00: 10-22, 10-23 and 10-24 came too.
    expect(foldDueTimes(daily, at('2026-10-20T18:00:00Z'), at('2026-10-24T01:00:00Z'), SHANGHAI)).toEqual({
      dueAt: at('2026-10-23T18:00:00Z'),
      missed: 3,
    });
  });

  it('只到期一次时没有错过', () => {
    const daily = { kind: 'daily', time: '02:00' } as const;
    expect(foldDueTimes(daily, at('2026-10-20T18:00:00Z'), at('2026-10-20T18:00:30Z'), SHANGHAI)).toEqual({
      dueAt: at('2026-10-20T18:00:00Z'),
      missed: 0,
    });
  });
});

describe('scheduleFrequencySchema', () => {
  it.each([
    ['时刻不是 HH:MM', { kind: 'daily', time: '2:00' }],
    ['时刻超出 23:59', { kind: 'daily', time: '24:00' }],
    ['每周没有选星期', { kind: 'weekly', weekdays: [], time: '09:00' }],
    ['星期重复', { kind: 'weekly', weekdays: [1, 1], time: '09:00' }],
    ['小时数不是 24 的约数', { kind: 'hourly', everyHours: 5, time: '00:00' }],
  ])('拒绝%s', (_, frequency) => {
    expect(scheduleFrequencySchema.safeParse(frequency).success).toBe(false);
  });
});
