import { describe, expect, it } from 'vitest';
import { DEV_API_PORT, DEV_WEB_PORT, devPorts } from './app.ts';

describe('devPorts', () => {
  it('uses the fixed ports unless the environment overrides them', () => {
    expect(devPorts({})).toEqual({ api: DEV_API_PORT, web: DEV_WEB_PORT });
    expect(devPorts({ AW_DEV_API_PORT: '50001' }, { api: 0 })).toEqual({ api: 50001, web: DEV_WEB_PORT });
    expect(devPorts({}, { api: 0 }).api).toBe(0);
  });

  it('rejects a value that is not a port', () => {
    for (const value of ['', 'abc', '0', '65536', '4782.5']) {
      expect(() => devPorts({ AW_DEV_WEB_PORT: value })).toThrow(/AW_DEV_WEB_PORT must be a port number/);
    }
  });
});
