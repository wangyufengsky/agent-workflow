import { insightsQuerySchema } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { localDateIn, resolvePeriod, startOfDay } from './insights.period.ts';

const SHANGHAI = 'Asia/Shanghai';
const LA = 'America/Los_Angeles';
const HOUR = 3_600_000;
// Wednesday 2026-01-07 10:00 in Shanghai.
const NOW = Date.parse('2026-01-07T02:00:00Z');

const resolve = (query: unknown, now = NOW, zone = SHANGHAI) =>
  resolvePeriod(insightsQuerySchema.parse(query), now, zone);

describe('resolvePeriod', () => {
  it('今天、本周（周一起）、近 7 天、近 30 天的日期范围，可以跨年', () => {
    expect(resolve({ period: 'today' })).toMatchObject({ from: '2026-01-07', to: '2026-01-07' });
    expect(resolve({ period: 'week' })).toMatchObject({ from: '2026-01-05', to: '2026-01-07' });
    expect(resolve({ period: 'last_7_days' })).toMatchObject({ from: '2026-01-01', to: '2026-01-07' });
    const month = resolve({ period: 'last_30_days' });
    expect(month).toMatchObject({ from: '2025-12-09', to: '2026-01-07' });
    expect(month.dates).toHaveLength(30);
  });

  it('本周在周一就是今天一天，在周日是整整七天', () => {
    const monday = Date.parse('2026-01-05T01:00:00Z');
    expect(resolve({ period: 'week' }, monday).dates).toEqual(['2026-01-05']);
    const sunday = Date.parse('2026-01-11T01:00:00Z');
    expect(resolve({ period: 'week' }, sunday)).toMatchObject({ from: '2026-01-05', to: '2026-01-11' });
  });

  it('区间为所在时区 from 当天 0:00 到 to 次日 0:00', () => {
    const p = resolve({ period: 'custom', from: '2026-01-01', to: '2026-01-02' });
    expect(p.start).toBe(Date.parse('2025-12-31T16:00:00Z'));
    expect(p.end).toBe(Date.parse('2026-01-02T16:00:00Z'));
    expect(p.dates).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('「今天」取决于时区：同一时刻在上海与洛杉矶是不同的日期', () => {
    expect(resolve({ period: 'today' }, NOW, SHANGHAI).from).toBe('2026-01-07');
    expect(resolve({ period: 'today' }, NOW, LA).from).toBe('2026-01-06');
  });

  it('夏令时开始那天只有 23 小时', () => {
    const p = resolve({ period: 'custom', from: '2026-03-08', to: '2026-03-08' }, NOW, LA);
    expect(p.end - p.start).toBe(23 * HOUR);
    expect(startOfDay('2026-03-08', LA)).toBe(Date.parse('2026-03-08T08:00:00Z'));
    expect(startOfDay('2026-03-09', LA)).toBe(Date.parse('2026-03-09T07:00:00Z'));
  });

  it('夏令时跳过午夜的时区（哈瓦那）：一天从时钟跳到 1:00 的那一刻开始，不含前一天的最后一小时', () => {
    const havana = 'America/Havana';
    const start = startOfDay('2026-03-08', havana);
    expect(start).toBe(Date.parse('2026-03-08T05:00:00Z'));
    expect(localDateIn(havana)(start)).toBe('2026-03-08');
    expect(localDateIn(havana)(start - 1)).toBe('2026-03-07');
  });
});

describe('insightsQuerySchema', () => {
  it.each([
    [{ period: 'custom' }, 'from'],
    [{ period: 'custom', from: '2026-01-02', to: '2026-01-01' }, 'to'],
    [{ period: 'custom', from: '2025-01-01', to: '2026-01-02' }, 'to'],
    [{ period: 'week', from: '2026-01-01' }, 'from'],
  ])('拒绝 %j', (query, path) => {
    const result = insightsQuerySchema.safeParse(query);
    expect(result.error?.issues.map((i) => i.path[0])).toEqual([path]);
  });

  it('自定义最多 366 天', () => {
    expect(insightsQuerySchema.safeParse({ period: 'custom', from: '2024-01-01', to: '2024-12-31' }).success).toBe(
      true,
    );
  });
});

describe('localDateIn', () => {
  it('同一时刻在两个时区归入不同的日期', () => {
    const ms = Date.parse('2026-05-01T20:00:00Z');
    expect(localDateIn(SHANGHAI)(ms)).toBe('2026-05-02');
    expect(localDateIn(LA)(ms)).toBe('2026-05-01');
  });
});
