import { describe, expect, it } from 'vitest';
import { DEV_API_PORT, DEV_WEB_PORT, devPorts, isSupportedGitVersion, isSupportedOpencodeVersion } from './app.ts';

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

describe('isSupportedOpencodeVersion', () => {
  it('accepts 1.18.0 through every 1.90 patch release (D156)', () => {
    for (const version of ['1.18.0', '1.18.35', '1.19.0', '1.19.4', '1.20.0', '1.90.0', '1.90.12']) {
      expect(isSupportedOpencodeVersion(version)).toBe(true);
    }
  });

  it('rejects versions outside the range and output that is not a release version', () => {
    for (const version of ['1.17.9', '1.4.0', '1.91.0', '2.0.0', '0.19.0', '1.19', '1.19.0-beta.1', 'v1.19.0', '']) {
      expect(isSupportedOpencodeVersion(version)).toBe(false);
    }
  });
});

describe('isSupportedGitVersion', () => {
  it('2.30 及以后的版本，含平台的写法（D225）', () => {
    for (const version of ['2.30.0', '2.30.2', '2.31', '2.45.1.windows.1', '2.50.1', '3.0.0']) {
      expect(isSupportedGitVersion(version)).toBe(true);
    }
    for (const version of ['2.29.3', '2.25.1', '1.8.3.1', 'unknown', '']) {
      expect(isSupportedGitVersion(version)).toBe(false);
    }
  });
});
