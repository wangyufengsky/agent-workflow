import { posix } from 'node:path';
import { SaxesParser } from 'saxes';

export type BuildHints = {
  name?: string;
  group?: string;
  dependencies: string[];
  modules: string[];
  spring: boolean;
  batch: boolean;
  junit: boolean;
  aggregate: boolean;
};

function modulePath(value: string) {
  const normalized = value.replace(/^\.\//, '').replace(/\/$/, '');
  return /^[\w.-]+(?:\/[\w.-]+)*$/.test(normalized) &&
    normalized.split('/').every((part) => part !== '..' && part !== '.')
    ? normalized
    : undefined;
}

export function mavenHints(content: string): BuildHints {
  const hints: BuildHints = {
    modules: [],
    dependencies: [],
    spring: false,
    batch: false,
    junit: false,
    aggregate: false,
  };
  const path: string[] = [];
  let value = '';
  let parentGroup: string | undefined;
  let dependency: { group?: string; artifact?: string } = {};
  const parser = new SaxesParser();
  parser.on('doctype', () => {
    throw new Error('Unsupported Maven XML doctype');
  });
  parser.on('opentag', ({ name }) => {
    if (path.length >= 64) throw new Error('Maven XML nesting limit');
    value = '';
    path.push(name);
    if (path.join('/') === 'project/dependencies/dependency') dependency = {};
  });
  parser.on('text', (text) => {
    value += text;
  });
  parser.on('closetag', () => {
    const tag = path.join('/');
    const text = value.trim();
    if (tag === 'project/artifactId' && text) hints.name = text;
    if (tag === 'project/groupId' && text) hints.group = text;
    if (tag === 'project/parent/groupId' && text) parentGroup = text;
    if (tag === 'project/dependencies/dependency/groupId') dependency.group = text;
    if (tag === 'project/dependencies/dependency' && dependency.group && dependency.artifact)
      hints.dependencies.push(`${dependency.group}:${dependency.artifact}`);
    if (tag === 'project/packaging') hints.aggregate = text === 'pom';
    if (tag === 'project/modules/module') {
      const module = modulePath(text);
      if (module) hints.modules.push(module);
    }
    if (tag === 'project/dependencies/dependency/artifactId') {
      dependency.artifact = text;
      hints.junit ||= /^(?:junit(?:-|$)|spring-boot-starter-test$)/.test(text);
      hints.spring ||= /^(?:spring-boot-starter-web(?:flux)?|spring-boot-starter-jersey)$/.test(text);
      hints.batch ||= text === 'spring-boot-starter-batch' || text === 'spring-batch-core';
    }
    path.pop();
    value = '';
  });
  parser.write(content).close();
  if (!hints.group && parentGroup) hints.group = parentGroup;
  return hints;
}

function gradleCode(content: string) {
  return content.replace(/"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (token) =>
    token.startsWith('/') ? token.replace(/[^\r\n]/g, ' ') : token,
  );
}

export function gradleHints(text: string): BuildHints {
  const content = gradleCode(text);
  return {
    modules: [],
    dependencies: [
      ...content.matchAll(
        /^\s*(?:api|implementation|compileOnly|runtimeOnly|testImplementation|testCompileOnly|testRuntimeOnly)\s*\(?\s*project\s*\(\s*(?:path\s*[:=]\s*)?(["'])(:[\w.-]+(?::[\w.-]+)*)\1\s*\)/gm,
      ),
    ].flatMap((match) => (match[2] === undefined ? [] : [match[2]])),
    spring: /['"]org\.springframework\.boot:spring-boot-starter-(?:web(?:flux)?|jersey)(?::[^'"]*)?['"]/.test(content),
    batch:
      /['"]org\.springframework(?:\.boot|\.batch):(?:spring-boot-starter-batch|spring-batch-core)(?::[^'"]*)?['"]/.test(
        content,
      ),
    junit:
      /['"](?:org\.junit[^:'"]*:[^'"]+|junit:junit(?::[^'"]*)?|org\.springframework\.boot:spring-boot-starter-test(?::[^'"]*)?)['"]|\buseJUnitPlatform\s*\(/.test(
        content,
      ),
    aggregate: false,
  };
}

export function gradleSettings(text: string, directory: string) {
  const content = gradleCode(text);
  const modules = new Map<string, string>();
  for (const include of content.matchAll(/^[\t ]*include[\t ]*(?:\(([^)]*)\)|([^\r\n]+))/gm)) {
    const argumentsText = include[1] ?? include[2] ?? '';
    if (argumentsText.replace(/(["']):?[\w.-]+(?::[\w.-]+)*\1/g, '').replace(/[\s,]/g, '') !== '') continue;
    for (const match of argumentsText.matchAll(/(["'])(:?[\w.-]+(?::[\w.-]+)*)\1/g)) {
      const project = match[2]?.replace(/^:/, '');
      if (!project) continue;
      const relative = modulePath(project.replaceAll(':', '/'));
      if (relative) modules.set(`:${project}`, posix.join(directory, relative));
    }
  }
  for (const override of content.matchAll(
    /^\s*project\s*\(\s*['"](:[\w.:-]+)['"]\s*\)\.projectDir\s*=\s*file\s*\(\s*['"]([^'"]+)['"]\s*\)/gm,
  )) {
    if (!override[1] || !override[2] || !modules.has(override[1])) continue;
    const relative = modulePath(override[2]);
    if (relative) modules.set(override[1], posix.join(directory, relative));
    else modules.delete(override[1]);
  }
  return modules;
}
