import { BashPolicy, type PermissionAction, type PermissionRule, RoleBaseAgent } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { sessionPermissionRules } from './opencode.config.ts';

/** opencode 1.19 `Wildcard.match`: `*` is any characters (newlines too), `?` one, and a trailing ` *` may match nothing. */
function matches(pattern: string, text: string): boolean {
  let source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  if (source.endsWith(' .*')) source = `${source.slice(0, -3)}( .*)?`;
  return new RegExp(`^${source}$`, 's').test(text);
}

/** Splits at `&&`, `||`, `;` and `|` outside quotes, as opencode's bash parser does for the commands below. */
function subCommands(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | undefined;
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i);
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === ';' || c === '|' || (c === '&' && command.charAt(i + 1) === '&')) {
      if (command.charAt(i + 1) === c) i++;
      parts.push(current.trim());
      current = '';
    } else current += c;
  }
  return [...parts, current.trim()];
}

/**
 * How opencode 1.19 decides a bash call (12 §2, D35): each sub-command is evaluated on its own text, redirections
 * included, the last matching rule wins, and the call asks as soon as one sub-command is not allowed
 * (`permissions.live.test.ts` and `opencode.permissions.oc.test.ts` check it on the real opencode).
 */
function decide(rules: readonly PermissionRule[], command: string): PermissionAction {
  const actions = subCommands(command).map(
    (sub) => rules.findLast((r) => r.permission === 'bash' && matches(r.pattern, sub))?.action ?? 'ask',
  );
  if (actions.includes('deny')) return 'deny';
  return actions.every((a) => a === 'allow') ? 'allow' : 'ask';
}

const reviewer = (checkCommands: string[] = []) =>
  sessionPermissionRules(RoleBaseAgent.Reviewer, BashPolicy.Auto, { checkCommands });
/** Planner and reviewer sessions without a project check, and executors under `ai.bashPolicy = ask`. */
const READONLY_PRESETS = [
  ['只读会话', reviewer()],
  ['执行者 ask 策略', sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Ask)],
] as const;

/** Commands that look read-only by name but write files or run other programs (D63). */
const ESCAPES = [
  'find . -delete',
  'find . -name "*.ts" -exec rm {} \\;',
  'find . -execdir sh -c "echo x" \\;',
  'find . -ok rm {} \\;',
  'find . -okdir rm {} \\;',
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
  'echo x --version',
];
/** A program's version as one command (D64). */
const VERSION_QUERIES = [
  'node --version',
  'npx --version',
  'java -version',
  'java -version 2>&1',
  'mvn -v',
  'pnpm -v',
  'python3 -V',
  'go version',
];
/** Commands that end like a version query but are not one, and inline scripts, which always ask (D64). */
const NOT_VERSION_QUERIES = [
  'npx tsc --version && rm x',
  'rm x && node --version',
  'rm -rf src --version',
  'npx rimraf src --version',
  // Without a TTY npx installs and runs any package from the registry, so only `npx --version` itself is a query.
  'npx tsc --version',
  'npx some-pkg --version',
  'PATH=. node --version',
  './deploy.sh --version',
  'java -version > version.txt',
  '>v.txt java -version 2>&1',
  'rake -v',
  "node -e \"require('fs').writeFileSync('x', '')\"",
  'node --experimental-strip-types -e "import(\'./src/stats.ts\')"',
  'python -c "print(1)"',
  "python3 -c \"open('x', 'w')\"",
  'bash -c "rm x"',
  'sh -c "rm x"',
];

/**
 * Commands read-only sessions ran in a user's project (T-1 of opencode-workflow-java-test), each of which used to ask
 * (D100): filters, archive and class listings, file facts, lookups, and stderr thrown away.
 */
const READS_D100 = [
  'find src config db scripts docs -type f | sort',
  'cat .gitignore; echo ---; sed -n 1,60p docs/x.md',
  "sed -n '1,60p' docs/architecture.md",
  "sed -n '/TODO/p' src/App.java",
  'unzip -l ~/.m2/repository/org/x/x-1.0.jar | grep Inventory | head',
  'unzip -Z -1 lib/x.jar',
  'jar tf lib/x.jar | sort | uniq -c',
  'javap -p -cp "$JAR" com.example.Inventory',
  'command -v mvn; ls ~/.m2 2>/dev/null',
  'grep -rniE "stock|inventory" --include=*.java . 2>/dev/null | grep -v test',
  'find . -name "*.sql" 2>/dev/null | head -20',
  "awk -F, '{print $2}' data.csv | sort | uniq",
  'cut -d: -f1 /etc/passwd | tr a-z A-Z',
  'file target/app.jar',
  'stat -f %z pom.xml',
  'du -sh src',
  'tree -L 2 src',
  'diff -u a.txt b.txt',
  'type mvn',
  'basename src/main/App.java; dirname src/main/App.java; realpath pom.xml',
  'wc -l src/*.java 2>&1',
];
/** Each still writes a file or runs another program, so it asks even though the command is on the list (D100). */
const ESCAPES_D100 = [
  'sed -i s/a/b/ pom.xml',
  'sed -n -i 1p pom.xml',
  'sed -n 1p pom.xml -i',
  "sed -n '1,5w out.txt' pom.xml",
  "sed -n '1w out.txt;1p' pom.xml",
  "sed -n 's/a/b/ep' pom.xml",
  'sed -n -f script.sed pom.xml',
  'sed 1,60p docs/x.md',
  'awk \'BEGIN{system("rm -rf src")}\'',
  'awk \'{print > "out.txt"}\' data.csv',
  'awk \'{print | "sh"}\' data.csv',
  'awk \'BEGIN{"date" | getline d}\'',
  'awk -f prog.awk data.csv',
  'sort -o sorted.txt data.txt',
  'sort --output=sorted.txt data.txt',
  'uniq in.txt out.txt',
  'unzip x.zip',
  'unzip -o x.zip -d out',
  'javap -J-javaagent:evil.jar Foo',
  'file -C -m magic',
  'tree -o tree.txt',
  'ls > files.txt',
  'cat a 2>/dev/null > b',
  'find . -delete 2>/dev/null',
  'sort data.txt 2>/dev/null > out.txt',
  'xargs rm < files.txt',
  'find . -name "*.class" | xargs rm',
  'command mvn test',
  'env rm x',
  'PATH=/opt/homebrew/bin:$PATH mvn -v',
  './scripts/mvn.sh -q test 2>&1 | tail -40',
];

describe.each(READONLY_PRESETS)('只读 bash 规则（%s）', (_name, rules) => {
  it.each(READS_D100)('只读的过滤、列表与查询命令放行（D100）：%s', (command) => {
    expect(decide(rules, command)).toBe('allow');
  });

  it.each(ESCAPES_D100)('白名单命令的写文件与执行写法、其他程序照常询问（D100）：%s', (command) => {
    expect(decide(rules, command)).toBe('ask');
  });

  it.each(ESCAPES)('会写文件或执行其他程序的命令不被放行：%s', (command) => {
    expect(decide(rules, command)).toBe('ask');
  });

  it.each(READS)('只读命令照常放行：%s', (command) => {
    expect(decide(rules, command)).toBe('allow');
  });

  it.each(VERSION_QUERIES)('版本查询放行：%s', (command) => {
    expect(decide(rules, command)).toBe('allow');
  });

  it.each(NOT_VERSION_QUERIES)('不是单条版本查询的命令询问：%s', (command) => {
    expect(decide(rules, command)).toBe('ask');
  });
});

/**
 * With a project check command, read-only sessions also run the same tool's usual test commands (D64), but no other
 * subcommand of the tool, and the D63 escapes still ask.
 */
const SAME_TOOL: ReadonlyArray<{ check: string; allowed: string[]; asked: string[] }> = [
  {
    check: 'mvn -q test',
    allowed: [
      'mvn test',
      'mvn -q test',
      'mvn -o test',
      'mvn -q -o test',
      'mvn -o -q test',
      'mvn test -Dtest=InventoryTest',
      'mvn -q test -Dtest=InventoryTest#lowStock',
      'mvn test 2>&1 | tail -30',
      'mvn -q -o test 2>&1 | tail -30',
      'mvn test -Dtest=InventoryTest 2>&1',
      './mvnw test',
    ],
    asked: [
      'mvn deploy',
      'mvn install',
      'mvn -q deploy test',
      // More phases after `test` run too; the check command itself is held to the same shape.
      'mvn test deploy',
      'mvn -q test install',
      'mvn test site-deploy',
      'mvn test -Dtest=X deploy',
      'mvn test -Dtest=X deploy 2>&1',
      'mvn -q test > f',
      // Wildcards cannot tell a second flag from a phase, so a second argument asks too.
      'mvn test -Dtest=X -o',
      'mvn exec:java',
      'mvn test > f',
      'mvn test > f 2>&1',
      'mvn test 2>&1 > f',
    ],
  },
  {
    check: 'npm test',
    allowed: [
      'npm test',
      'npm run test',
      'pnpm test',
      'yarn test',
      'node --test',
      'node --test src/stats.test.ts 2>&1',
    ],
    asked: [
      'npm publish',
      'npm install',
      'npm i lodash',
      'npm run build',
      'npm run test > out.txt',
      'node src/index.ts',
      'node -e "process.exit(0)"',
      'npx tsc',
      // npx installs and runs the package when the project does not have it.
      'npx vitest run',
      'npx jest',
    ],
  },
  {
    check: 'pnpm test',
    allowed: ['pnpm test', 'pnpm run test', 'npm test', 'pnpm vitest run', 'pnpm exec vitest run src'],
    asked: ['pnpm install', 'pnpm publish', 'pnpm add lodash', 'pnpm dlx cowsay', 'npx jest', 'npx vitest run'],
  },
  {
    check: 'npx vitest run',
    allowed: ['npx vitest run', 'npx vitest run src/stats.test.ts'],
    asked: ['npx jest', 'npx tsc', 'npx vitest'],
  },
  {
    check: './gradlew test',
    allowed: [
      './gradlew test',
      './gradlew -q test',
      './gradlew test --offline',
      './gradlew test --tests InventoryTest',
      './gradlew test --tests InventoryTest 2>&1',
      'gradle test',
    ],
    asked: [
      './gradlew publish',
      './gradlew build',
      'gradle installDist',
      './gradlew test publish',
      'gradle -q test publish',
      './gradlew test --tests InventoryTest publish',
      './gradlew test --tests InventoryTest --offline',
    ],
  },
  {
    check: 'go test ./...',
    allowed: ['go test ./...', 'go test -run TestMedian ./stats/...', 'go test'],
    asked: [
      'go build ./...',
      'go run .',
      'go generate ./...',
      'go install ./...',
      // These run another program in place of the test binary or the compiler.
      'go test -exec rm ./...',
      'go test -toolexec ./x ./...',
      'go test ./... -exec=rm',
      'go test -exec rm ./... 2>&1',
    ],
  },
  {
    check: 'pytest',
    allowed: ['pytest', 'pytest -q tests/test_stats.py', 'python -m pytest', 'python3 -m pytest -x'],
    asked: ['pip install pytest', 'python setup.py install', 'python -c "import os"', 'python script.py'],
  },
];

describe.each(SAME_TOOL)('检查命令 $check：同一工具的测试命令', ({ check, allowed, asked }) => {
  const rules = reviewer([check]);

  it.each(allowed)('放行：%s', (command) => {
    expect(decide(rules, command)).toBe('allow');
  });

  it.each(asked)('询问：%s', (command) => {
    expect(decide(rules, command)).toBe('ask');
  });
});

describe('项目检查命令本身（D51）', () => {
  it('规划者与评审者运行检查命令不询问，带参数或重定向也一样；执行者的规则不变', () => {
    const checks = ['make check', 'make check'];
    for (const base of [RoleBaseAgent.Planner, RoleBaseAgent.Reviewer]) {
      const rules = sessionPermissionRules(base, BashPolicy.Ask, { checkCommands: checks });
      for (const command of ['make check', 'make check V=1', 'make check > check.log 2>&1'])
        expect(decide(rules, command), `${base}: ${command}`).toBe('allow');
      expect(decide(rules, 'make install')).toBe('ask');
    }
    expect(sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Ask, { checkCommands: checks })).toEqual(
      sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Ask),
    );
  });
});

describe('没有项目检查命令或检查命令不是已知测试工具时', () => {
  it.each([[[]], [['make check']]])('测试命令照常询问（检查命令 %j）', (checks) => {
    const rules = reviewer(checks);
    for (const command of ['mvn test', 'npm test', 'go test ./...', 'pytest'])
      expect(decide(rules, command), command).toBe('ask');
  });
});

/**
 * Patterns the user always allowed in a project (D101) join the read-only rules of its later sessions: the command
 * runs without asking, with `2>&1` or `2>/dev/null` too, but redirections and the D63 / D100 escapes still ask.
 */
describe('项目级「总是允许」的命令（D101）', () => {
  const allowed = ['./scripts/mvn.sh *', 'make *'];
  const presets = [
    ['规划者', sessionPermissionRules(RoleBaseAgent.Planner, BashPolicy.Auto, { allowedBash: allowed })],
    ['评审者', sessionPermissionRules(RoleBaseAgent.Reviewer, BashPolicy.Auto, { allowedBash: allowed })],
    ['执行者 ask 策略', sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Ask, { allowedBash: allowed })],
  ] as const;

  it.each(presets)('%s：放行记住的命令，重定向与其他命令照常询问', (_name, rules) => {
    for (const command of [
      './scripts/mvn.sh -q test 2>&1 | tail -40',
      './scripts/mvn.sh -q test',
      './scripts/mvn.sh 2>/dev/null',
      'make lint',
    ])
      expect(decide(rules, command), command).toBe('allow');
    for (const command of [
      './scripts/mvn.sh -q test > out.txt',
      './scripts/mvn.sh -q test 2>&1 > out.txt',
      './scripts/other.sh',
      'mvn deploy',
    ])
      expect(decide(rules, command), command).toBe('ask');
  });

  it('执行者 auto 策略的规则不变：除 Git 外本来都放行', () => {
    expect(sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Auto, { allowedBash: allowed })).toEqual(
      sessionPermissionRules(RoleBaseAgent.Executor, BashPolicy.Auto),
    );
  });
});
