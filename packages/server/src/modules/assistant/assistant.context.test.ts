import { describe, expect, it } from 'vitest';
import { localTime } from './assistant.context.ts';

const AT = Date.UTC(2025, 9, 9, 20, 30, 0);

describe('助手的当地时间（15 §2）', () => {
  it.each([
    ['Asia/Shanghai', '2025-10-10T04:30:00+08:00', '2025-10-10', 'Friday', '+08:00'],
    ['UTC', '2025-10-09T20:30:00+00:00', '2025-10-09', 'Thursday', '+00:00'],
    ['America/Los_Angeles', '2025-10-09T13:30:00-07:00', '2025-10-09', 'Thursday', '-07:00'],
    ['Asia/Kolkata', '2025-10-10T02:00:00+05:30', '2025-10-10', 'Friday', '+05:30'],
  ])('%s：日期跨天时按当地日期', (timeZone, now, date, weekday, utcOffset) => {
    expect(localTime(AT, timeZone)).toEqual({ now, date, weekday, timeZone, utcOffset });
  });
});
