import { TaskStatus } from '@aw/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LiveApp, outcome, startLiveApp, TASK_TIMEOUT_MS } from './live-app.ts';

/**
 * D63 and D64 against the real opencode (07 §6): in a read-only session (the code review's reviewer step, check
 * command `mvn -q test`) commands of the read-only list, version queries and the same tool's test commands run
 * without asking, while the same commands with arguments that write or run programs ask. A version query does not
 * cover what follows it: opencode matches each sub-command on its own, so the `rm` after `&&` asks.
 */
const ESCAPES = [
  'find . -name nothing-here -delete',
  'cat README.md > copy.md',
  'git log -1 --output=log.txt',
  'mvn test > test-output.txt',
];
const READS = ['find src -name "*.java"', 'cat README.md', 'git log -1 --oneline', 'java -version', 'mvn test'];
const AFTER_VERSION_QUERY = { command: 'java -version && rm nothing-here.txt', asks: 'rm nothing-here.txt' };

let live: LiveApp;
beforeAll(async () => {
  live = await startLiveApp('permissions');
}, 120_000);
afterAll(() => live.close());

describe('@live 只读会话的 bash 规则', () => {
  it(
    '只读命令、版本查询与同一工具的测试命令不询问；带写入或执行参数的命令与版本查询后串联的命令询问',
    async () => {
      const commands = [...READS, ...ESCAPES, AFTER_VERSION_QUERY.command];
      const task = await live.runTask(
        'code_review',
        'java-inventory',
        `这是一次权限规则测试，不需要真正审查代码。请用 bash 工具逐条运行下面的命令（每条单独调用一次，原样运行，不要合并），然后提交结果，summary 写「完成」：\n${commands.map((c) => `- \`${c}\``).join('\n')}`,
      );
      expect(outcome(task)).toEqual({ status: TaskStatus.Review, failure: null });
      const asked = live.asked();
      for (const command of ESCAPES)
        expect(
          asked.some((a) => a.includes(command)),
          command,
        ).toBe(true);
      expect(asked.some((a) => a.includes(AFTER_VERSION_QUERY.asks))).toBe(true);
      for (const command of READS)
        expect(
          asked.some((a) => a === `bash: ${command}`),
          command,
        ).toBe(false);
    },
    TASK_TIMEOUT_MS,
  );
});
