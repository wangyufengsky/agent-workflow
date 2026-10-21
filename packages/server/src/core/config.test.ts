import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const TOKEN = 'a'.repeat(64);

describe('loadConfig', () => {
  it('解析环境变量并把数据目录转为绝对路径', () => {
    const config = loadConfig({ AW_API_TOKEN: TOKEN, AW_DATA_DIR: 'data', AW_PORT: '4000' });
    expect(config).toMatchObject({ apiToken: TOKEN, port: 4000, webDir: undefined, logLevel: 'info' });
    expect(config.dataDir).toBe(join(process.cwd(), 'data'));
  });

  it('拒绝过短的令牌', () => {
    expect(() => loadConfig({ AW_API_TOKEN: 'short', AW_DATA_DIR: 'data' })).toThrow();
  });
});
