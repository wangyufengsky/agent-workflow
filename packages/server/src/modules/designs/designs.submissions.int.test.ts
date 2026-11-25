import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  AttemptKind,
  AttemptStatus,
  DesignDepth,
  DesignDiagramKind,
  DesignLayoutStyle,
  DesignReviewState,
  DesignSectionKind,
  ErrorCode,
  MCP_SESSION_ARG,
  McpToolName,
  ServerEventType,
  SessionAgent,
  ThemeId,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject } from '../../../test/helpers/tasks.ts';
import { DATABASE_FILE, openDatabase } from '../../core/db/database.ts';
import { createDesignsRepo } from './designs.repo.ts';

it('设计提交经真实 MCP 落库，拒绝错误章节，保留重写前快照并更新复审', async () => {
  const t = await createTestApp();
  const db = openDatabase(join(t.dataDir, DATABASE_FILE), join(import.meta.dirname, '../../../migrations'));
  const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
  try {
    const { project, repo: source } = await addProject(t, { files: { 'src/main.ts': 'export const x = 1;\n' } });
    const repo = createDesignsRepo(db.db);
    const designId = randomUUID();
    const template = repo.findTemplate('general');
    if (template === undefined) throw new Error('Builtin design template missing');
    repo.insertDesign({
      id: designId,
      projectId: project.id,
      title: '源码设计',
      depth: DesignDepth.Standard,
      templateKey: template.key,
      templateSnapshot: {
        key: template.key,
        name: template.name,
        defaultSections: template.defaultSections,
        focusPrompt: template.focusPrompt,
      },
      layoutStyle: DesignLayoutStyle.Doc,
      theme: ThemeId.Default,
      excludePatterns: [],
      aiReviewEnabled: false,
      sourceSnapshot: {
        branch: 'main',
        commitSha: null,
        dirty: false,
        scannedAt: 1,
        analyzableCount: 1,
        skippedCount: 0,
        skippedReasons: {},
        techStack: ['TypeScript'],
      },
      outlineConfirmedAt: null,
      lastExportedPath: null,
      lastExportedAt: null,
      createdAt: 1,
      updatedAt: 1,
    });
    repo.insertFiles([
      {
        id: randomUUID(),
        designId,
        sectionId: null,
        relPath: 'src/main.ts',
        contentHash: 'a'.repeat(64),
        responsibility: null,
        symbols: [],
        updatedAt: 1,
      },
    ]);

    const work = async (kind: AttemptKind, targets: string[]) => {
      t.fake.enqueue(script().hang());
      const attempt = await t.app.services.attempts.start({
        kind,
        agent: SessionAgent.Designer,
        model: null,
        projectId: project.id,
        taskId: null,
        nodeId: null,
        roleId: null,
        directory: source.path,
        title: '设计',
        prompt: '分析源码',
      });
      if (attempt.opencodeSessionId === null) throw new Error('Expected a started design session');
      repo.insertRun({
        id: randomUUID(),
        designId,
        seq: repo.listRuns(designId).length + 1,
        attemptId: attempt.id,
        targetSectionIds: targets,
        doneSectionIds: [],
        instruction: null,
        createdAt: 1,
      });
      const submit = (tool: McpToolName, input: Record<string, unknown>) =>
        callTool(mcp, tool, { ...input, [MCP_SESSION_ARG]: attempt.opencodeSessionId });
      const unrelated =
        kind === AttemptKind.DesignOutline ? McpToolName.SubmitDesignSection : McpToolName.SubmitDesignOutline;
      for (const tool of [unrelated, McpToolName.Recall, McpToolName.AskUser, McpToolName.DbListConnections]) {
        expect(await submit(tool, {})).toMatchObject({
          isError: true,
          body: { code: ErrorCode.McpToolNotAllowed },
        });
      }
      expect(await submit(McpToolName.ReportProgress, { message: '正在分析源码' })).toEqual({
        isError: false,
        body: { ok: true },
      });
      return { id: attempt.id, submit };
    };

    const outline = await work(AttemptKind.DesignOutline, []);
    expect(
      await outline.submit(McpToolName.SubmitDesignOutline, {
        sections: [
          { kind: DesignSectionKind.Overview, title: '总览', scopePaths: [] },
          { kind: DesignSectionKind.Module, title: '入口', scopePaths: ['src'] },
        ],
      }),
    ).toEqual({ isError: false, body: { accepted: true } });
    const [overview, entry] = repo.listSections(designId);
    if (overview === undefined || entry === undefined) throw new Error('Target sections missing');
    repo.updateDesign(designId, { outlineConfirmedAt: 2 });

    const generate = await work(AttemptKind.DesignGenerate, [overview.id, entry.id]);
    const sectionInput = {
      sectionId: overview.id,
      summary: '初版',
      blocks: [{ type: 'diagram_ref', diagramId: 'system' }],
      files: [],
      diagrams: [
        {
          id: 'system',
          kind: DesignDiagramKind.Architecture,
          title: '系统',
          nodes: [{ id: 'main', label: '入口', relPath: 'src/main.ts' }],
          edges: [],
        },
      ],
    };
    expect(
      await generate.submit(McpToolName.SubmitDesignSection, { ...sectionInput, sectionId: 'wrong' }),
    ).toMatchObject({
      isError: true,
      body: { code: ErrorCode.ValidationFailed, details: { issues: expect.any(Array) } },
    });
    expect(repo.listSections(designId).map(({ blocks }) => blocks)).toEqual([null, null]);
    const updated = waitForEvent(t.app.events, ServerEventType.DesignUpdated, (event) => event.designId === designId);
    expect(await generate.submit(McpToolName.SubmitDesignSection, sectionInput)).toEqual({
      isError: false,
      body: { remainingSectionIds: [entry.id] },
    });
    await updated;
    expect(t.app.services.attempts.get(generate.id).status).toBe(AttemptStatus.Running);
    expect(repo.listSections(designId)[0]?.blocks).toEqual([
      { type: 'diagram_ref', diagramId: repo.listDiagrams(designId)[0]?.id },
    ]);
    expect(
      await generate.submit(McpToolName.SubmitDesignSection, {
        sectionId: entry.id,
        summary: '入口',
        blocks: [{ type: 'markdown', markdown: '入口定义常量。' }],
        files: [{ relPath: 'src/main.ts', responsibility: '入口常量', symbols: [] }],
        diagrams: [],
      }),
    ).toEqual({ isError: false, body: { remainingSectionIds: [] } });
    expect(t.app.services.attempts.get(generate.id).status).toBe(AttemptStatus.Succeeded);

    const revise = await work(AttemptKind.DesignRevise, [overview.id]);
    expect(
      await revise.submit(McpToolName.SubmitDesignSection, {
        ...sectionInput,
        files: [{ relPath: 'src/main.ts', responsibility: '不应覆盖入口职责', symbols: [] }],
      }),
    ).toMatchObject({ isError: true, body: { code: ErrorCode.ValidationFailed } });
    expect(await revise.submit(McpToolName.SubmitDesignSection, { ...sectionInput, summary: '重写' })).toEqual({
      isError: false,
      body: { remainingSectionIds: [] },
    });
    expect(repo.listSections(designId)[0]).toMatchObject({ summary: '重写', previous: { summary: '初版' } });
    expect(repo.listFiles(designId)[0]).toMatchObject({ sectionId: entry.id, responsibility: '入口常量' });

    const review = await work(AttemptKind.DesignReview, [overview.id, entry.id]);
    expect(
      await review.submit(McpToolName.SubmitDesignReview, {
        findings: [
          { sectionId: overview.id, reviewState: DesignReviewState.Passed, notes: [] },
          {
            sectionId: entry.id,
            reviewState: DesignReviewState.NeedsAttention,
            notes: [{ severity: 'warn', message: '需要补充常量用途', relPath: 'src/main.ts', lineStart: 1 }],
          },
        ],
      }),
    ).toEqual({ isError: false, body: { accepted: true } });
    expect(repo.listSections(designId).map(({ reviewState }) => reviewState)).toEqual([
      DesignReviewState.Passed,
      DesignReviewState.NeedsAttention,
    ]);
    expect(t.app.services.attempts.get(review.id).status).toBe(AttemptStatus.Succeeded);
  } finally {
    await mcp.close();
    db.close();
    await t.close();
  }
});
