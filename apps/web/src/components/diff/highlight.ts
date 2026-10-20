import type { HighlighterCore, LanguageRegistration, ThemedToken } from 'shiki/core';

type LanguageModule = { default: LanguageRegistration[] };

/**
 * Languages highlighted in diffs, by file extension; each grammar is a lazily loaded chunk. Languages that embed many
 * others (Markdown, Vue, PHP) are left out to keep the chunks small; their files show without colours.
 */
const LANGUAGES: Readonly<Record<string, { id: string; load: () => Promise<LanguageModule> }>> = {
  ts: { id: 'typescript', load: () => import('shiki/langs/typescript.mjs') },
  mts: { id: 'typescript', load: () => import('shiki/langs/typescript.mjs') },
  cts: { id: 'typescript', load: () => import('shiki/langs/typescript.mjs') },
  tsx: { id: 'tsx', load: () => import('shiki/langs/tsx.mjs') },
  js: { id: 'javascript', load: () => import('shiki/langs/javascript.mjs') },
  mjs: { id: 'javascript', load: () => import('shiki/langs/javascript.mjs') },
  cjs: { id: 'javascript', load: () => import('shiki/langs/javascript.mjs') },
  jsx: { id: 'jsx', load: () => import('shiki/langs/jsx.mjs') },
  json: { id: 'json', load: () => import('shiki/langs/json.mjs') },
  css: { id: 'css', load: () => import('shiki/langs/css.mjs') },
  scss: { id: 'scss', load: () => import('shiki/langs/scss.mjs') },
  less: { id: 'less', load: () => import('shiki/langs/less.mjs') },
  html: { id: 'html', load: () => import('shiki/langs/html.mjs') },
  xml: { id: 'xml', load: () => import('shiki/langs/xml.mjs') },
  yaml: { id: 'yaml', load: () => import('shiki/langs/yaml.mjs') },
  yml: { id: 'yaml', load: () => import('shiki/langs/yaml.mjs') },
  toml: { id: 'toml', load: () => import('shiki/langs/toml.mjs') },
  ini: { id: 'ini', load: () => import('shiki/langs/ini.mjs') },
  sh: { id: 'shellscript', load: () => import('shiki/langs/shellscript.mjs') },
  bash: { id: 'shellscript', load: () => import('shiki/langs/shellscript.mjs') },
  sql: { id: 'sql', load: () => import('shiki/langs/sql.mjs') },
  java: { id: 'java', load: () => import('shiki/langs/java.mjs') },
  kt: { id: 'kotlin', load: () => import('shiki/langs/kotlin.mjs') },
  groovy: { id: 'groovy', load: () => import('shiki/langs/groovy.mjs') },
  scala: { id: 'scala', load: () => import('shiki/langs/scala.mjs') },
  go: { id: 'go', load: () => import('shiki/langs/go.mjs') },
  rs: { id: 'rust', load: () => import('shiki/langs/rust.mjs') },
  py: { id: 'python', load: () => import('shiki/langs/python.mjs') },
  rb: { id: 'ruby', load: () => import('shiki/langs/ruby.mjs') },
  c: { id: 'c', load: () => import('shiki/langs/c.mjs') },
  h: { id: 'c', load: () => import('shiki/langs/c.mjs') },
  cpp: { id: 'cpp', load: () => import('shiki/langs/cpp.mjs') },
  hpp: { id: 'cpp', load: () => import('shiki/langs/cpp.mjs') },
  cs: { id: 'csharp', load: () => import('shiki/langs/csharp.mjs') },
  swift: { id: 'swift', load: () => import('shiki/langs/swift.mjs') },
  dart: { id: 'dart', load: () => import('shiki/langs/dart.mjs') },
  lua: { id: 'lua', load: () => import('shiki/langs/lua.mjs') },
  graphql: { id: 'graphql', load: () => import('shiki/langs/graphql.mjs') },
};
const FILE_NAMES: Readonly<Record<string, string>> = { Dockerfile: 'dockerfile', Makefile: 'make' };
const LOAD_BY_NAME: Readonly<Record<string, () => Promise<LanguageModule>>> = {
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  make: () => import('shiki/langs/make.mjs'),
};

const THEME = 'aw';

let core: Promise<HighlighterCore> | undefined;

/**
 * One highlighter for the app, with the JavaScript regex engine (the WebAssembly one would need `wasm-unsafe-eval`
 * in the CSP, 03 §9) and a theme of CSS variables that diff.module.css maps to theme tokens.
 */
async function highlighter(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: THEME, variablePrefix: '--syntax-' })],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return core;
}

function languageOf(path: string): { id: string; load: () => Promise<LanguageModule> } | undefined {
  const name = path.split('/').at(-1) ?? path;
  const byName = FILE_NAMES[name];
  if (byName !== undefined) {
    const load = LOAD_BY_NAME[byName];
    return load === undefined ? undefined : { id: byName, load };
  }
  const dot = name.lastIndexOf('.');
  return dot < 0 ? undefined : LANGUAGES[name.slice(dot + 1).toLowerCase()];
}

/** Tokens per line of `code`; null when the file's language is not highlighted. */
export async function highlight(path: string, code: string): Promise<ThemedToken[][] | null> {
  const language = languageOf(path);
  if (language === undefined) return null;
  const h = await highlighter();
  if (!h.getLoadedLanguages().includes(language.id)) await h.loadLanguage((await language.load()).default);
  return h.codeToTokensBase(code, { lang: language.id, theme: THEME });
}

export type { ThemedToken };
