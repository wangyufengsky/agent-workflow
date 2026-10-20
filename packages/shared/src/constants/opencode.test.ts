import { describe, expect, it } from 'vitest';
import { BashPolicy } from '../enums/system.ts';
import { BASH_PERMISSION_PRESETS, type PermissionAction, type PermissionRule } from './opencode.ts';

/**
 * How opencode 1.19 decides a bash command (12 §2, D35): each sub-command of a pipeline is matched on its full text,
 * redirections included, against the rules' wildcard patterns (`*` any characters), and the last matching rule
 * wins. `*` here also spans newlines, so the test is at least as strict as opencode.
 */
function decide(rules: readonly PermissionRule[], command: string): PermissionAction | undefined {
  const matches = (pattern: string) =>
    new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replaceAll('*', '.*')
        .replaceAll('?', '.')}$`,
      's',
    ).test(command);
  return rules.findLast((r) => r.permission === 'bash' && matches(r.pattern))?.action;
}

/** Commands that look read-only by name but write files or run other programs. */
const ESCAPES = [
  'find . -delete',
  'find . -name "*.ts" -exec rm {} ;',
  'find . -execdir sh -c "echo x" ;',
  'find . -ok rm {} ;',
  'find . -okdir rm {} ;',
  'find . -fprint out.txt',
  'find . -fprintf out.txt "%p"',
  'find . -fls out.txt',
  'cat a.ts > b.ts',
  'echo hi >> notes.md',
  'head -1 a.ts > b.ts',
  'rg --pre ./run.sh TODO',
  'git log --output=log.txt',
  'git diff --output=d.patch',
  'git grep -Ovim TODO',
  'git grep --open-files-in-pager=vim TODO',
];
const READS = [
  'ls -la',
  'cat package.json',
  'find src -name "*.ts"',
  'find . -type f -newer package.json',
  'rg -n TODO src',
  'grep -rn TODO src',
  'git log --oneline -5',
  'git diff --stat HEAD',
  'echo ---',
  'node --version',
];

describe.each(['readonly', BashPolicy.Ask] as const)('只读 bash 规则（%s）', (preset) => {
  const rules = BASH_PERMISSION_PRESETS[preset];

  it.each(ESCAPES)('会写文件或执行其他程序的命令不被放行：%s', (command) => {
    expect(decide(rules, command)).toBe('ask');
  });

  it.each(READS)('只读命令照常放行：%s', (command) => {
    expect(decide(rules, command)).toBe('allow');
  });
});
