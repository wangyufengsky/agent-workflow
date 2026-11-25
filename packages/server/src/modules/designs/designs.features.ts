import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BuiltinDesignTemplateKey } from '@aw/builtin';
import { AppError, DESIGN_SCAN_MAX_FILE_BYTES, ErrorCode } from '@aw/shared';
import { z } from 'zod';
import { designExclusion } from './designs.exclusions.ts';

const packageFeatures = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  workspaces: z.union([z.array(z.string()), z.object({ packages: z.array(z.string()).optional() })]).optional(),
});

function parseManifest(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new AppError(ErrorCode.ValidationFailed, 'Invalid project manifest', {
      path: 'package.json',
      message: error.message,
    });
  }
  const result = packageFeatures.safeParse(json);
  if (!result.success)
    throw new AppError(ErrorCode.ValidationFailed, 'Invalid project manifest', {
      path: 'package.json',
      issues: result.error.issues,
    });
  return result.data;
}

/** 模板推荐只读根目录和普通 package.json，不遍历子目录，也不计算文件哈希。 */
export async function inspectDesignProject(root: string, exclusions: readonly string[] = []) {
  const entries = (await readdir(root, { withFileTypes: true })).filter(
    (entry) => designExclusion(entry.name, exclusions) === undefined,
  );
  const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const dirs = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase()));
  const dependencies = new Set<string>();
  let hasWorkspaces = files.has('pnpm-workspace.yaml');
  if (files.has('package.json')) {
    const path = join(root, 'package.json');
    if ((await stat(path)).size <= DESIGN_SCAN_MAX_FILE_BYTES) {
      const manifest = parseManifest(await readFile(path, 'utf8'));
      for (const name of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})])
        dependencies.add(name);
      hasWorkspaces ||= manifest.workspaces !== undefined;
    }
  }
  const java = files.has('pom.xml') || [...files].some((name) => name.startsWith('build.gradle'));
  const web = ['react', 'vite', 'next'].some((name) => dependencies.has(name));
  const agent =
    ['mcp', 'agents', 'prompts'].some((name) => dirs.has(name)) ||
    [...dependencies].some((name) => name.startsWith('@modelcontextprotocol/') || name === '@openai/agents');
  const fullstack =
    hasWorkspaces ||
    (dirs.has('apps') && dirs.has('packages')) ||
    (['server', 'backend', 'api'].some((name) => dirs.has(name)) &&
      ['web', 'frontend', 'client'].some((name) => dirs.has(name)));
  const techStack: string[] = [];
  if (files.has('package.json')) techStack.push('JavaScript');
  if (files.has('tsconfig.json') || dependencies.has('typescript')) techStack.push('TypeScript');
  if (java) techStack.push('Java');
  for (const [name, label] of [
    ['react', 'React'],
    ['next', 'Next.js'],
    ['vite', 'Vite'],
    ['fastify', 'Fastify'],
  ] as const)
    if (dependencies.has(name)) techStack.push(label);
  for (const [file, label] of [
    ['go.mod', 'Go'],
    ['pyproject.toml', 'Python'],
    ['Cargo.toml', 'Rust'],
  ] as const)
    if (files.has(file)) techStack.push(label);
  if (agent) techStack.push('AI Agent');
  const recommendedTemplateKey = agent
    ? BuiltinDesignTemplateKey.AiAgent
    : fullstack
      ? BuiltinDesignTemplateKey.Fullstack
      : java
        ? BuiltinDesignTemplateKey.JavaBackend
        : web
          ? BuiltinDesignTemplateKey.ReactFrontend
          : BuiltinDesignTemplateKey.General;
  return { techStack, recommendedTemplateKey };
}
