const fileWord = /^[\p{L}\p{N}_.][\p{L}\p{N}\p{M}_./-]*$/u;
const readers = new Set(['cat', 'head', 'tail', 'wc', 'stat', 'file', 'cksum', 'shasum', 'sha256sum']);

function readerFiles(command: string): string[] | undefined {
  const [program, ...args] = command.split(' ');
  const reader = program?.replace(/^(?:\/usr\/bin\/|\/bin\/)/u, '');
  if (!reader || !readers.has(reader)) return undefined;
  if ((reader === 'head' || reader === 'tail') && args[0] === '-n' && /^[1-9][0-9]{0,3}$/u.test(args[1] ?? '')) {
    args.splice(0, 2);
  }
  if (reader === 'wc' && /^-[lwc]$/u.test(args[0] ?? '')) args.shift();
  if (reader === 'shasum' && args[0] === '-a' && args[1] === '256') args.splice(0, 2);
  return args;
}

// 只消费完整的字面量词和管道符。正则里的管道不分段，拼接词、展开、重定向或其他控制符交给人工。
function searchPipeline(command: string): string[][] | undefined {
  const token =
    /[ \t]+|\||(?:[\p{L}\p{N}\p{M}_./-]+|'(?:[^'\\\r\n]|\\[^'\\\r\n])*'|"(?:[^"$`!\\\r\n]|\\[.()[\]{}+*?^|-])*")(?=[ \t|]|$)/uy;
  let stage: string[] = [];
  const stages = [stage];
  while (token.lastIndex < command.length) {
    const next = token.exec(command);
    if (!next) return;
    const word = next[0];
    if (word === '|') {
      stage = [];
      stages.push(stage);
    } else if (word[0] !== ' ' && word[0] !== '\t') {
      stage.push(word[0] === "'" || word[0] === '"' ? word.slice(1, -1) : word);
    }
  }
  return stages;
}

function searchFiles(command: string): string[] | undefined {
  const stages = searchPipeline(command);
  if (!stages) return;
  const files: string[] = [];
  for (const [index, [program, ...args]] of stages.entries()) {
    const piped = index > 0;
    switch (program) {
      case 'grep': {
        while (args[0] && /^-[rnoEFihHvwxcl]+$/u.test(args[0])) {
          if (piped && args[0].includes('r')) return;
          args.shift();
        }
        const pattern = args.shift();
        if (!pattern || pattern.startsWith('-') || (piped ? args.length !== 0 : args.length === 0)) return;
        files.push(...args);
        break;
      }
      case 'sort':
        if (args[0] === '-u') args.shift();
        if (piped ? args.length !== 0 : args.length === 0) return;
        files.push(...args);
        break;
      case 'uniq':
        if (!piped || args.length) return;
        break;
      case 'tr':
        if (!piped || args.length !== 2 || args[0] !== '-d' || !args[1] || args[1].startsWith('-')) return;
        break;
      case 'sed':
        // 仅识别删去字面量前缀的替换，sed 的脚本也可能打开文件或执行命令。
        if (!piped || args.length !== 1 || !args[0] || !/^s\/\w+(?:\\\.)?\/\/g?$/u.test(args[0])) return;
        break;
      case 'comm': {
        if (/^-[123]+$/u.test(args[0] ?? '')) args.shift();
        const inputs = args.filter((file) => file !== '-');
        if (args.length !== 2 || inputs.length !== (piped ? 1 : 2)) return;
        files.push(...inputs);
        break;
      }
      default:
        return;
    }
  }
  return files;
}

/** 返回这次调用要逐一核对的文件。所有路径还需在真实文件系统上验证扫描范围。 */
export function readonlyBashFiles(command: string): string[] | undefined {
  const files = readerFiles(command) ?? searchFiles(command);
  if (files?.length && files.every((file) => fileWord.test(file) && !file.split('/').includes('..'))) return files;
}
