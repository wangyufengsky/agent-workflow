import { describe, expect, it } from 'vitest';
import { FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT } from '../../constants/functional-testing.ts';
import {
  functionalTestCaseSaveSchema,
  functionalTestCaseSchema,
  functionalTestLaunchSchema,
} from './functional-testing.ts';

const java = { directory: '.', source: 'pom.xml', script: FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT, readyPath: '/health' };
const node = { directory: '.', source: 'package.json', script: 'serve:test', readyPath: '/health' };
const spring = { ...java, script: 'spring-boot:run', profile: 'qa' };

describe('功能测试选择普通 Java 主类', () => {
  it.each(['Server', 'qa.boot.Orders', '订单服务.进程', 'demo.$Main_1'])('接受 Java 主类 %s', (mainClass) => {
    expect(functionalTestLaunchSchema.parse({ ...java, mainClass }).mainClass).toBe(mainClass);
  });

  it.each([undefined, '', 'a..b', 'a/Server', 'a.8Server', 'a.Main --port=80', 'test.class', 'a.服务\n'])(
    '拒绝遗漏或非法主类 %s',
    (mainClass) => {
      const result = functionalTestLaunchSchema.safeParse({ ...java, mainClass });
      expect(result.error?.issues.map(({ path }) => path)).toContainEqual(['mainClass']);
    },
  );

  it('Java 运行选项保留主版本及显式关闭 provided 依赖', () => {
    const launch = { ...java, mainClass: 'legacy.record', javaVersion: 8, includeProvided: false };
    expect(functionalTestLaunchSchema.parse(launch)).toEqual(launch);
    expect(functionalTestLaunchSchema.safeParse({ ...launch, javaVersion: 7 }).error?.issues).toEqual([
      expect.objectContaining({ path: ['javaVersion'] }),
    ]);
  });

  it('传统 Node 或 Spring 模式保留既有 shape，只在普通 Java 模式接受 mainClass', () => {
    expect(functionalTestLaunchSchema.parse(node)).toEqual(node);
    expect(functionalTestLaunchSchema.parse({ ...node, script: FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT })).toMatchObject({
      script: FUNCTIONAL_TEST_JAVA_MAIN_SCRIPT,
    });
    expect(functionalTestLaunchSchema.parse(spring)).toEqual(spring);
    expect(
      functionalTestLaunchSchema.safeParse({ ...spring, javaVersion: 8, includeProvided: true }).error?.issues,
    ).toEqual([
      expect.objectContaining({ path: ['javaVersion'] }),
      expect.objectContaining({ path: ['includeProvided'] }),
    ]);
    for (const launch of [node, spring]) {
      expect(functionalTestLaunchSchema.safeParse({ ...launch, mainClass: 'Server' }).error?.issues).toEqual([
        expect.objectContaining({ path: ['mainClass'] }),
      ]);
    }
    expect(functionalTestLaunchSchema.safeParse({ ...java, mainClass: 'Server', profile: 'qa' }).error?.issues).toEqual(
      [expect.objectContaining({ path: ['profile'] })],
    );
  });
});

it('新功能用例仅接受精确探测键，并保留已有用例的读取兼容性', () => {
  const draft = { title: 'Default rate', requirement: 'Read the baseline rate', steps: [] };
  const legacy = { ...draft, requires: ['rates_ping: GET /system/ping -> 204'] };
  expect(functionalTestCaseSaveSchema.safeParse(legacy).success).toBe(false);
  expect(functionalTestCaseSaveSchema.parse({ ...draft, requires: ['rates_ping'] }).requires).toEqual(['rates_ping']);
  expect(functionalTestCaseSaveSchema.parse(draft).requires).toEqual([]);
  expect(functionalTestCaseSchema.parse({ ...legacy, id: 'case', number: 'FT-01', version: 1 }).requires).toEqual(
    legacy.requires,
  );
});
