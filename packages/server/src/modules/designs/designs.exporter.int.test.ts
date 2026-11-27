import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import {
  DesignDepth,
  DesignDiagramKind,
  DesignLayoutStyle,
  DesignReviewState,
  DesignSectionKind,
  ErrorCode,
  PermissionMode,
  ThemeId,
} from '@aw/shared';
import { THEMES } from '@aw/shared/theme';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportDesignSite } from './designs.exporter.ts';
import type { DesignSiteContents } from './designs.site-model.ts';

function contents(projectRoot: string): DesignSiteContents {
  const designId = 'public-design';
  const sectionId = 'public-section';
  const diagramId = 'public-diagram';
  return {
    design: {
      id: designId,
      projectId: 'PRIVATE_PROJECT_ID',
      title: '服务设计',
      depth: DesignDepth.Standard,
      templateKey: 'custom',
      templateSnapshot: {
        key: 'custom',
        name: '私人模板',
        defaultSections: [{ kind: DesignSectionKind.Overview, title: '项目总览', scopeHint: '.' }],
        focusPrompt: 'PRIVATE_TEMPLATE_PROMPT',
      },
      layoutStyle: DesignLayoutStyle.Doc,
      theme: ThemeId.Codex,
      excludePatterns: ['PRIVATE_PATTERN'],
      permissionMode: PermissionMode.Ask,
      aiReviewEnabled: false,
      sourceSnapshot: {
        branch: 'main',
        commitSha: 'b'.repeat(40),
        dirty: false,
        scannedAt: 1,
        analyzableCount: 2,
        skippedCount: 1,
        skippedReasons: { sensitive: 1 },
        techStack: ['TypeScript'],
      },
      outlineConfirmedAt: 1,
      lastExportedPath: join(projectRoot, '..', 'PRIVATE_OLD_EXPORT'),
      lastExportedAt: 10,
      createdAt: 1,
      updatedAt: 1,
    },
    sections: [
      {
        id: sectionId,
        designId,
        seq: 1,
        selected: true,
        kind: DesignSectionKind.Overview,
        title: '项目总览',
        scopePaths: ['PRIVATE_SCOPE'],
        summary: `源码位于 ${projectRoot}/src/index.ts`,
        blocks: [
          { type: 'markdown', markdown: '使用 **启动函数**</script><img src="https://example.test">\u2028' },
          { type: 'diagram_ref', diagramId },
        ],
        reviewState: DesignReviewState.None,
        reviewNotes: [{ severity: 'warn', message: 'PRIVATE_REVIEW' }],
        previous: { summary: 'PRIVATE_PREVIOUS', blocks: [], files: [], diagrams: [] },
        updatedAt: 1,
      },
    ],
    files: [
      {
        id: 'file-public',
        designId,
        sectionId,
        relPath: 'src/index.ts',
        contentHash: 'PRIVATE_HASH',
        responsibility: '启动服务',
        symbols: [],
        updatedAt: 1,
      },
      {
        id: 'file-scanned',
        designId,
        sectionId: null,
        relPath: 'PRIVATE_SCANNED_PATH',
        contentHash: 'a'.repeat(64),
        responsibility: null,
        symbols: [],
        updatedAt: 1,
      },
    ],
    diagrams: [
      {
        id: diagramId,
        designId,
        sectionId,
        kind: DesignDiagramKind.Architecture,
        title: '系统图',
        nodes: [{ id: 'main', label: '入口' }],
        edges: [],
        updatedAt: 1,
      },
    ],
    exportedAt: 50,
  };
}

describe('项目设计离线导出', () => {
  let root: string;
  let project: string;
  let site: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'aw-design-export-'));
    project = join(root, '私有项目');
    site = join(root, '离线 站点');
    await mkdir(join(project, 'docs', 'design'), { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('写出自包含站点，保持 JSON 和经典脚本一致，排除应用内部和未分析数据', async () => {
    await exportDesignSite({ ...contents(project), projectRoot: project, targetDir: site });
    expect((await readdir(site)).sort()).toEqual([
      '.aw-design-site.json',
      'assets',
      'design-data.js',
      'design-model.json',
      'index.html',
    ]);
    const json = await readFile(join(site, 'design-model.json'), 'utf8');
    const marker = await readFile(join(site, '.aw-design-site.json'), 'utf8');
    const script = await readFile(join(site, 'design-data.js'), 'utf8');
    const context = { window: Object.create(null) };
    runInNewContext(script, context);
    expect(context.window.__AW_DESIGN_DATA__).toEqual(JSON.parse(json));
    expect(script).not.toContain('</script>');
    expect(script).not.toContain('\u2028');
    expect(json).toContain('</script>');
    expect(json).toContain('src/index.ts');
    expect(json + script + marker).not.toMatch(/PRIVATE_/);
    expect(json + script + marker).not.toContain(project);
    expect(await readFile(join(site, 'index.html'), 'utf8')).toContain('assets/viewer.js');
    const style = await readFile(join(site, 'assets', 'style.css'), 'utf8');
    expect(style).toContain(`--bg: ${THEMES[ThemeId.Codex].tokens.bg};`);
    expect(style).toContain(`--ink: ${THEMES[ThemeId.Codex].tokens.ink};`);
    expect(style).toContain(`color-scheme: ${THEMES[ThemeId.Codex].colorScheme};`);
  });

  it('只为已有引用片段建立文件入口，未引用文件与仓库全文不随站点导出', async () => {
    const source = contents(project);
    const filename = 'src/evidence.ts';
    await mkdir(join(project, 'src'), { recursive: true });
    await writeFile(join(project, filename), 'const PRIVATE_UNQUOTED_LINE = true;\nreturn 42;\n');
    const selected = source.sections.map((section) => ({
      ...section,
      blocks: [
        ...(section.blocks ?? []),
        {
          type: 'code' as const,
          relPath: filename,
          lineStart: 2,
          lineEnd: 2,
          language: 'typescript',
          code: 'return 42;',
        },
      ],
    }));
    const files = [
      ...source.files,
      {
        id: 'evidence-only',
        designId: source.design.id,
        sectionId: null,
        relPath: filename,
        contentHash: 'b'.repeat(64),
        responsibility: null,
        symbols: [],
        updatedAt: 1,
      },
    ];
    await exportDesignSite({ ...source, sections: selected, files, projectRoot: project, targetDir: site });
    const exported = await readFile(join(site, 'design-model.json'), 'utf8');
    expect(JSON.parse(exported).files).toContainEqual({
      id: 'evidence-only',
      sectionId: selected[0]?.id,
      relPath: filename,
      responsibility: null,
      symbols: [],
    });
    expect(exported).toContain('return 42;');
    expect(exported).not.toContain('PRIVATE_UNQUOTED_LINE');
    expect(exported).not.toContain('PRIVATE_SCANNED_PATH');
  });

  it('交易可用扫描文件 ID 定位已引用路径，离线只导出该交易牵涉的来源', async () => {
    const source = contents(project);
    const path = 'src/dispatch.ts';
    const file = source.files.find(({ sectionId }) => sectionId === null);
    const diagram = source.diagrams[0];
    if (!file || !diagram) throw new Error('Expected scan inventory and diagram');
    const transaction = {
      type: 'transaction' as const,
      title: '派发指令',
      diagramId: diagram.id,
      evidence: [{ evidenceClass: 'inferred' as const, rationale: '根据分派节点归纳。' }],
    };
    await exportDesignSite({
      ...source,
      sections: source.sections.map((section) => ({ ...section, blocks: [transaction] })),
      files: [...source.files, { ...file, id: 'entry', relPath: path }],
      diagrams: [{ ...diagram, nodes: [{ id: 'send', label: '派发指令', targetKind: 'file', targetId: 'entry' }] }],
      projectRoot: project,
      targetDir: site,
    });
    const json = await readFile(join(site, 'design-model.json'), 'utf8');
    const [graph] = JSON.parse(json).diagrams;
    expect(graph.presentation.sourcePaths).toEqual([path]);
    expect(graph.presentation.nodes[0].source).toEqual({ fileId: 'entry', path });
    expect(JSON.parse(json).files.map((item: { relPath: string }) => item.relPath)).not.toContain(path);
    expect(json).not.toContain('PRIVATE_SCANNED_PATH');
  });

  it('显式确认后覆盖同名入口，保留其他文件，并依次处理同目录的导出', async () => {
    await mkdir(join(site, 'assets'), { recursive: true });
    await writeFile(join(site, 'index.html'), 'hand-written index');
    await writeFile(join(site, 'notes.md'), 'hand-written notes');
    await writeFile(join(site, 'assets', 'custom.txt'), 'hand-written asset');
    const options = { ...contents(project), projectRoot: project, targetDir: site };
    await expect(exportDesignSite(options)).rejects.toMatchObject({ code: ErrorCode.DesignExportDirNotEmpty });
    expect(await readFile(join(site, 'index.html'), 'utf8')).toBe('hand-written index');
    await Promise.all([
      exportDesignSite({ ...options, overwrite: true }),
      exportDesignSite({ ...options, overwrite: true, exportedAt: 100 }),
    ]);
    expect(await readFile(join(site, 'index.html'), 'utf8')).toContain('<!doctype html>');
    expect(await readFile(join(site, 'notes.md'), 'utf8')).toBe('hand-written notes');
    expect(await readFile(join(site, 'assets', 'custom.txt'), 'utf8')).toBe('hand-written asset');
    expect((await readdir(root)).sort()).toEqual(['离线 站点', '私有项目'].sort());
    expect([50, 100]).toContain(JSON.parse(await readFile(join(site, 'design-model.json'), 'utf8')).exportedAt);
  });

  it('验证临时站点时发现断链，旧站点保持原样', async () => {
    const options = { ...contents(project), projectRoot: project, targetDir: site };
    await exportDesignSite(options);
    const previous = await readFile(join(site, 'design-model.json'), 'utf8');
    await expect(exportDesignSite({ ...options, diagrams: [] })).rejects.toThrow('unresolved diagram reference');
    expect(await readFile(join(site, 'design-model.json'), 'utf8')).toBe(previous);
    expect((await readdir(root)).sort()).toEqual(['离线 站点', '私有项目'].sort());
  });

  it('保护项目根、祖先、设计目录及其别名', async () => {
    const alias = join(root, '设计别名');
    await symlink(join(project, 'docs', 'design'), alias, 'junction');
    for (const targetDir of [
      root,
      project,
      join(project, 'docs'),
      join(project, 'docs', 'design'),
      join(alias, 'site'),
    ]) {
      await expect(
        exportDesignSite({
          ...contents(project),
          projectRoot: project,
          targetDir,
          overwrite: true,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ValidationFailed });
    }
  });
});
