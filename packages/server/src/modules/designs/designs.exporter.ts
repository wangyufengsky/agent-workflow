import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AppError, ErrorCode } from '@aw/shared';
import { z } from 'zod';
import { SOURCE_DESIGN_SITE_ASSETS_DIR, SOURCE_DESIGN_SITE_COPY_FILE } from '../../core/config.ts';
import {
  type DesignSiteContents,
  type DesignSiteModel,
  designSiteModel,
  scriptJson,
  siteDataScript,
} from './designs.site-model.ts';
import { designSiteStylesheet } from './designs.site-style.ts';

const MARKER = '.aw-design-site.json';
const EXPORT_FILES = ['index.html', 'design-data.js', 'design-model.json', MARKER] as const;
const ASSETS = ['style.css', 'viewer.js'] as const;
const targetQueues = new Map<string, Promise<void>>();
const markerSchema = z.object({ schemaVersion: z.literal(1), designId: z.string().min(1), exportedAt: z.number() });
const copySchema = z.object({ pageTitle: z.string(), noScript: z.string(), localPath: z.string() }).passthrough();
function htmlText(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const indexPage = (copy: z.infer<typeof copySchema>): string => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' file:; style-src 'self' file:; base-uri 'none'; form-action 'none'">
<title>${htmlText(copy.pageTitle)}</title>
<link rel="stylesheet" href="assets/style.css">
<script defer src="design-data.js"></script>
<script defer src="assets/viewer.js"></script>
</head>
<body>
<noscript>${htmlText(copy.noScript)}</noscript>
<div id="design-site"></div>
</body>
</html>
`;

type ExportOptions = DesignSiteContents & {
  targetDir: string;
  overwrite?: boolean | undefined;
  projectRoot: string | null;
  assetsDir?: string | undefined;
  copyFile?: string | undefined;
};

const missing = (error: unknown): boolean => error instanceof Error && 'code' in error && error.code === 'ENOENT';

async function metadata(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
}

function invalid(message: string): never {
  throw new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path: ['targetDir'], message }] });
}

function within(path: string, base: string): boolean {
  const rel = relative(base, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

async function canonicalCandidate(path: string): Promise<string> {
  if ((await metadata(path)) !== undefined) return realpath(path);
  return join(await canonicalCandidate(dirname(path)), basename(path));
}

async function canonicalTarget(path: string, projectRoot: string | null): Promise<string> {
  if (!isAbsolute(path)) invalid('The export directory must be absolute');
  const selected = resolve(path);
  const current = await metadata(selected);
  if (current !== undefined && !current.isDirectory()) invalid('The export target must be a directory');
  const target = await canonicalCandidate(selected);
  if (target === dirname(target)) invalid('A filesystem root cannot be an export directory');
  if (projectRoot !== null) {
    const project = await canonicalCandidate(projectRoot);
    const localPaths = [join(project, 'docs', 'design'), join(project, '.git')];
    const protectedPaths = [...localPaths, ...(await Promise.all(localPaths.map(canonicalCandidate)))];
    if (within(project, target) || protectedPaths.some((path) => within(target, path) || within(path, target))) {
      invalid('The export directory overlaps a protected project location');
    }
  }
  return target;
}

type ExistingSite = { exists: boolean; extraRoot: string[]; extraAssets: string[] };

function overwriteRequired(): never {
  throw new AppError(ErrorCode.DesignExportDirNotEmpty, 'The export directory has files outside the current site');
}

async function readSiteMarker(target: string) {
  const path = join(target, MARKER);
  if (!(await metadata(path))?.isFile()) return undefined;
  const raw = await readFile(path, 'utf8');
  try {
    const result = markerSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function existingSite(target: string, designId: string, overwrite: boolean): Promise<ExistingSite> {
  const current = await metadata(target);
  if (current === undefined) return { exists: false, extraRoot: [], extraAssets: [] };
  if (!current.isDirectory()) invalid('The export target must be a directory');

  const entries = await readdir(target, { withFileTypes: true });
  if (entries.length === 0) return { exists: true, extraRoot: [], extraAssets: [] };
  const marker = await readSiteMarker(target);
  const assets = entries.find((entry) => entry.name === 'assets');
  if (assets !== undefined && !assets.isDirectory()) overwriteRequired();
  const assetEntries = assets === undefined ? [] : await readdir(join(target, 'assets'), { withFileTypes: true });
  const ownedRoot = new Set<string>(EXPORT_FILES);
  const ownedAssets = new Set<string>(ASSETS);
  const reserved = [
    ...entries.filter((entry) => ownedRoot.has(entry.name)),
    ...assetEntries.filter((entry) => ownedAssets.has(entry.name)),
  ];
  // 明确覆盖时替换同名普通文件。目录或链接可能含其他内容，不能作为站点文件替换。
  if (reserved.some((entry) => !entry.isFile())) overwriteRequired();
  const extraRoot = entries
    .filter((entry) => entry.name !== 'assets' && !ownedRoot.has(entry.name))
    .map(({ name }) => name);
  const extraAssets = assetEntries.filter((entry) => !ownedAssets.has(entry.name)).map(({ name }) => name);
  if (!overwrite && (marker?.designId !== designId || extraRoot.length > 0 || extraAssets.length > 0)) {
    overwriteRequired();
  }
  return { exists: true, extraRoot, extraAssets };
}

async function copyEntries(names: readonly string[], source: string, destination: string): Promise<void> {
  for (const name of names) {
    await cp(join(source, name), join(destination, name), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      force: false,
      errorOnExist: true,
      preserveTimestamps: true,
    });
  }
}

/** 整站在目标同级构建，旧目录先移到暂存区；发布失败时沿原路径恢复。 */
export async function exportDesignSite(options: ExportOptions): Promise<{ targetDir: string }> {
  const model = designSiteModel(options);
  if (model.sections.length === 0) {
    throw new AppError(ErrorCode.StateTransitionInvalid, 'The design has no completed sections to export');
  }
  const targetDir = await canonicalTarget(options.targetDir, options.projectRoot);
  const previous = targetQueues.get(targetDir);
  const queue = Promise.withResolvers<void>();
  targetQueues.set(targetDir, queue.promise);
  try {
    await previous;
    await writeSite(targetDir, options, model);
    return { targetDir };
  } finally {
    queue.resolve();
    if (targetQueues.get(targetDir) === queue.promise) targetQueues.delete(targetDir);
  }
}

async function validateStage(stage: string, model: DesignSiteModel, json: string, entry: string): Promise<void> {
  const [index, script, data, marker, style, viewer] = await Promise.all(
    ['index.html', 'design-data.js', 'design-model.json', MARKER, 'assets/style.css', 'assets/viewer.js'].map((path) =>
      readFile(join(stage, path), 'utf8'),
    ),
  );
  if (
    index !== entry ||
    data !== `${json}\n` ||
    script !== siteDataScript(json) ||
    !style?.trim() ||
    !viewer?.trim() ||
    marker === undefined ||
    markerSchema.parse(JSON.parse(marker)).designId !== model.designId
  ) {
    throw new Error('The staged design site is incomplete');
  }
  JSON.parse(data);
  const diagramSections = new Map(model.diagrams.map(({ id, sectionId }) => [id, sectionId]));
  for (const section of model.sections) {
    for (const block of section.blocks) {
      if (
        (block.type === 'diagram_ref' || block.type === 'transaction') &&
        diagramSections.get(block.diagramId) !== section.id
      ) {
        throw new Error('The staged design site contains an unresolved diagram reference');
      }
    }
  }
  for (const diagram of model.diagrams) {
    const ids = new Set(diagram.nodes.map(({ id }) => id));
    if (diagram.edges.some(({ from, to }) => !ids.has(from) || !ids.has(to))) {
      throw new Error('The staged design site contains an unresolved diagram edge');
    }
  }
}

function serializeSite(value: object, paths: readonly (string | null)[], redacted: string): string {
  const privatePaths = paths
    .filter((path): path is string => path !== null && isAbsolute(path) && dirname(path) !== path)
    .flatMap((path) => [path, path.replaceAll('\\', '/')]);
  return JSON.stringify(
    value,
    (_key, item: unknown) => {
      if (typeof item !== 'string') return item;
      return privatePaths.reduce((text, path) => text.replaceAll(path, redacted), item);
    },
    2,
  );
}

async function writeSite(targetDir: string, options: ExportOptions, model: DesignSiteModel): Promise<void> {
  await existingSite(targetDir, model.designId, options.overwrite === true);
  const assetDir = options.assetsDir ?? SOURCE_DESIGN_SITE_ASSETS_DIR;
  const [stylesheet, viewer, copyJson] = await Promise.all([
    readFile(join(assetDir, 'style.css'), 'utf8'),
    readFile(join(assetDir, 'viewer.js'), 'utf8'),
    readFile(options.copyFile ?? SOURCE_DESIGN_SITE_COPY_FILE, 'utf8'),
  ]);
  const copy = copySchema.parse(JSON.parse(copyJson));
  const entry = indexPage(copy);
  if (stylesheet.trim() === '' || viewer.trim() === '') throw new Error('Missing design site asset');
  await mkdir(dirname(targetDir), { recursive: true });
  const temp = await mkdtemp(join(dirname(targetDir), '.aw-design-export-tmp-'));
  const stage = join(temp, 'site');
  const backup = join(temp, 'previous');
  let stagedOldSite = false;
  try {
    await mkdir(join(stage, 'assets'), { recursive: true });
    const privatePaths = [options.projectRoot, targetDir, options.design.lastExportedPath];
    const json = serializeSite(model, privatePaths, copy.localPath);
    const { schemaVersion, designId, exportedAt, sourceSnapshot } = model;
    await writeFile(
      join(stage, MARKER),
      serializeSite({ schemaVersion, designId, exportedAt, sourceSnapshot }, privatePaths, copy.localPath),
    );
    await writeFile(join(stage, 'index.html'), entry);
    await writeFile(join(stage, 'design-model.json'), `${json}\n`);
    await writeFile(join(stage, 'design-data.js'), siteDataScript(json));
    await writeFile(join(stage, 'assets', 'style.css'), designSiteStylesheet(stylesheet));
    await writeFile(
      join(stage, 'assets', 'viewer.js'),
      `window.__AW_DESIGN_SITE_COPY__ = ${scriptJson(JSON.stringify(copy))};\n${viewer}`,
    );
    await validateStage(stage, model, json, entry);
    const original = await existingSite(targetDir, model.designId, options.overwrite === true);
    if (original.exists) {
      await rename(targetDir, backup);
      stagedOldSite = true;
      // 从已移开的目录复制非托管文件。替换失败时备份仍可原样恢复。
      const moved = await existingSite(backup, model.designId, options.overwrite === true);
      await copyEntries(moved.extraRoot, backup, stage);
      await copyEntries(moved.extraAssets, join(backup, 'assets'), join(stage, 'assets'));
    }
    await rename(stage, targetDir);
    stagedOldSite = false;
  } catch (error) {
    if (stagedOldSite) {
      await rename(backup, targetDir);
      stagedOldSite = false;
    }
    throw error;
  } finally {
    // 恢复本身失败时保留唯一的旧站点副本。
    if (!stagedOldSite) await rm(temp, { recursive: true, force: true });
  }
}
