import { describe, expect, it } from 'vitest';
import { unrunnableOf } from './acceptance.rules.ts';

describe('检查命令无法运行的判定（D116）', () => {
  it.each([
    ['mvn -q test', 127, '/bin/sh: mvn: command not found', 'mvn'],
    ['mvn -q test', 127, '/bin/sh: 1: mvn: not found', 'mvn'],
    ['mvn -q test', 127, '/usr/bin/bash: line 1: mvn: command not found', 'mvn'],
    ['cd api && CI=1 mvn -q test', 127, 'Scanning…\n/bin/sh: mvn: command not found\n', 'mvn'],
    ['JAVA_OPTS="-Xmx1g -Dfoo=bar" mvn test', 127, '/bin/sh: mvn: command not found', 'mvn'],
    ['./gradlew test', 127, '/bin/sh: ./gradlew: No such file or directory', './gradlew'],
  ])('`%s` 退出 %i 且 shell 报出它点名的程序：找不到', (command, exitCode, output, program) => {
    expect(unrunnableOf(command, exitCode, output)).toEqual({ program, reason: 'not_found' });
  });

  it('退出 126 且 shell 报没有执行权限：不能执行', () => {
    expect(unrunnableOf('./gradlew test', 126, '/bin/sh: ./gradlew: Permission denied')).toEqual({
      program: './gradlew',
      reason: 'not_executable',
    });
  });

  it.each([
    ['程序不是检查命令点名的（依赖没装，AI 能处理）', 'pnpm test', 127, 'sh: vitest: command not found'],
    ['退出码不是 127 / 126', 'mvn -q test', 1, '/bin/sh: mvn: command not found'],
    ['127 但没有 shell 的报错行', 'mvn -q test', 127, '[ERROR] tests failed'],
    ['报错类型与退出码不符', 'mvn -q test', 126, '/bin/sh: mvn: command not found'],
  ])('%s：按普通检查不通过处理', (_, command, exitCode, output) => {
    expect(unrunnableOf(command, exitCode, output)).toBeNull();
  });
});
