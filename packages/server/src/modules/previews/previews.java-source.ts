const IDENTIFIER = '[\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}][\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}\\p{Mn}\\p{Mc}\\p{Nd}]*';
const TOKEN =
  /\/\/[^\n\r]*|\/\*[\s\S]*?\*\/|"""(?:\\[\s\S]|(?!""")[\s\S])*"""|'''[\s\S]*?'''|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[\p{L}\p{Nl}\p{Sc}\p{Pc}][\p{L}\p{Nl}\p{Sc}\p{Pc}\p{Mn}\p{Mc}\p{Nd}]*|\.\.\.|[^\s]/gu;
const TYPE = new Set(['class', 'enum', 'record', 'interface']);
const MAIN = new RegExp(
  `^((?:(?:public|static|final|synchronized|strictfp) )+)void main \\( (?:final )?(?:java \\. lang \\. )?String (?:\\[ \\] ${IDENTIFIER}|\\.\\.\\. ${IDENTIFIER}|${IDENTIFIER} \\[ \\]) \\)(?: throws ${IDENTIFIER}(?:(?: \\. | , )${IDENTIFIER})*)?$`,
  'u',
);

function tokensOf(text: string): string[] {
  return [...text.matchAll(TOKEN)]
    .map(([token]) => token)
    .filter((token): token is string => token !== undefined && !token.startsWith('//') && !token.startsWith('/*'));
}

function endOf(tokens: string[], start: number): number {
  let depth = 1;
  for (let index = start + 1; index < tokens.length; index++) {
    if (tokens[index] === '{') depth++;
    else if (tokens[index] === '}' && --depth === 0) return index;
  }
  return tokens.length;
}

function hasMain(tokens: string[], open: number, end: number): boolean {
  let start = open + 1;
  for (let index = start; index < end; index++) {
    if (tokens[index] === ';') start = index + 1;
    if (tokens[index] !== '{') continue;
    const signature = MAIN.exec(tokens.slice(start, index).join(' '));
    const modifiers = signature?.[1]?.trim().split(' ');
    if (modifiers?.includes('public') && modifiers.includes('static')) return true;
    index = endOf(tokens, index);
    start = index + 1;
  }
  return false;
}

/** 源文件模式只运行首个顶层类型；模块按所选完全限定名验证其自身的 main。 */
export function hasJavaMain(source: string, mainClass: string, sourceMode: boolean): boolean {
  // Java 会在词法分析前展开 Unicode 转义；避免让转义改变注释或声明的含义。
  if (/\\u+[\da-fA-F]{4}/.test(source)) return false;
  const tokens = tokensOf(source);
  const lastDot = mainClass.lastIndexOf('.');
  const packageName = lastDot === -1 ? '' : mainClass.slice(0, lastDot);
  const className = mainClass.slice(lastDot + 1);
  const packageAt = tokens.indexOf('package');
  const declared = packageAt === -1 ? '' : tokens.slice(packageAt + 1, tokens.indexOf(';', packageAt)).join('');
  if (packageName !== declared) return false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '{') {
      index = endOf(tokens, index);
      continue;
    }
    if (token === undefined || !TYPE.has(token) || tokens[index - 1] === '.') continue;
    const body = tokens.indexOf('{', index + 2);
    if (body === -1) return false;
    const end = endOf(tokens, body);
    if (tokens[index + 1] === className) return hasMain(tokens, body, end);
    if (sourceMode) return false;
    index = end;
  }
  return false;
}
