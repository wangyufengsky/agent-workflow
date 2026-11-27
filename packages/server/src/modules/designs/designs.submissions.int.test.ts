import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  ATTEMPT_SUBMIT_TOOL,
  AttemptKind,
  AttemptStatus,
  createDbConnectionOp,
  createDesignOp,
  createDesignTemplateOp,
  DATA_EXPLORER_KEY,
  DbTlsMode,
  DbType,
  DesignDepth,
  DesignDiagramKind,
  DesignLayoutStyle,
  DesignReviewState,
  DesignSectionKind,
  ErrorCode,
  generateDesignOp,
  listDesignTemplatesOp,
  MCP_SESSION_ARG,
  MCP_TOOL_PREFIX,
  McpToolName,
  OPENCODE_AGENT_NAME,
  PermissionMode,
  ServerEventType,
  SessionAgent,
  setProjectDbConnectionsOp,
  stopDesignOp,
  submitDesignSectionInputSchema,
  ThemeId,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp } from '../../../test/helpers/app.ts';
import { testCipher } from '../../../test/helpers/cipher.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';
import { addProject } from '../../../test/helpers/tasks.ts';
import { DATABASE_FILE, openDatabase } from '../../core/db/database.ts';
import { OpencodeEventType } from '../opencode/index.ts';
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
      permissionMode: PermissionMode.Ask,
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
      const permissions = await t.fake.sessionRules({ sessionId: attempt.opencodeSessionId, directory: source.path });
      const visible = permissions
        .filter((rule) => rule.permission.startsWith(MCP_TOOL_PREFIX) && rule.action === 'allow')
        .map((rule) => rule.permission);
      expect(new Set(visible)).toEqual(
        new Set(
          [
            ATTEMPT_SUBMIT_TOOL[kind],
            McpToolName.ListDesignFiles,
            McpToolName.ReadDesignSection,
            ...([AttemptKind.DesignGenerate, AttemptKind.DesignRevise].some((k) => k === kind)
              ? [McpToolName.GetSubmissionGuide]
              : []),
            McpToolName.ReportProgress,
            McpToolName.Recall,
          ].map((name) => `${MCP_TOOL_PREFIX}${name}`),
        ),
      );
      const evidence = { messageId: 'msg_source', partId: 'prt_source' };
      expect(await submit(McpToolName.Recall, evidence)).toMatchObject({
        isError: true,
        body: { code: ErrorCode.NotFound },
      });
      t.fake.replay([
        {
          type: OpencodeEventType.Tool,
          sessionId: attempt.opencodeSessionId,
          ...evidence,
          callId: 'call_read',
          tool: 'read',
          status: 'completed',
          input: {},
          output: 'chapter evidence',
        },
      ]);
      expect(await submit(McpToolName.Recall, evidence)).toEqual({
        isError: false,
        body: { content: 'chapter evidence', offset: 0, totalLength: 16, nextOffset: null },
      });
      const forbidden = [
        { tool: unrelated, input: {} },
        { tool: McpToolName.AskUser, input: {} },
        { tool: McpToolName.DbListConnections, input: {} },
        { tool: McpToolName.DbDescribe, input: { connection: 'orders' } },
        { tool: McpToolName.DbQuery, input: { connection: 'orders', sql: 'SELECT 1' } },
      ];
      for (const { tool, input } of forbidden) {
        expect(await submit(tool, input)).toMatchObject({
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
    const initialGuide = await generate.submit(McpToolName.GetSubmissionGuide, {});
    expect(submitDesignSectionInputSchema.safeParse(initialGuide.body.example).success).toBe(true);
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
    const badBlocks = [
      {
        type: 'markdown',
        markdown: '入口',
        evidence: [{ evidenceClass: 'static', relPath: 'src/main.ts', lineStart: 1, lineEnd: 8 }],
      },
      { type: 'code', language: 'typescript', relPath: 'src/main.ts', lineStart: 1, lineEnd: 1, code: 'wrong' },
    ];
    const rejection = await generate.submit(McpToolName.SubmitDesignSection, { ...sectionInput, blocks: badBlocks });
    expect(rejection).toMatchObject({
      isError: true,
      body: {
        code: ErrorCode.ValidationFailed,
        details: {
          issues: [
            { path: ['blocks', 0, 'evidence', 0], relPath: 'src/main.ts', lineStart: 1, lineEnd: 8, fileLineCount: 1 },
            { path: ['blocks', 1, 'code'], relPath: 'src/main.ts', lineStart: 1, lineEnd: 1, fileLineCount: 1 },
          ],
        },
        guide: {
          skill: 'aw-design-analysis',
          tool: McpToolName.SubmitDesignSection,
          example: { blocks: expect.any(Array) },
        },
      },
    });
    expect(await generate.submit(McpToolName.GetSubmissionGuide, {})).toMatchObject({
      isError: false,
      body: {
        lastRejection: {
          fields: ['blocks.0.evidence.0', 'blocks.1.code'],
          sourceIssues: [
            { path: ['blocks', 0, 'evidence', 0], fileLineCount: 1, lineEnd: 8 },
            { path: ['blocks', 1, 'code'], relPath: 'src/main.ts', fileLineCount: 1 },
          ],
        },
      },
    });
    expect(repo.listSections(designId).map(({ blocks }) => blocks)).toEqual([null, null]);
    const updated = waitForEvent(t.app.events, ServerEventType.DesignUpdated, (event) => event.designId === designId);
    const correctedBlocks = [
      { ...badBlocks[0], evidence: [{ evidenceClass: 'static', relPath: 'src/main.ts', lineStart: 1, lineEnd: 1 }] },
      { ...badBlocks[1], code: 'export const x = 1;' },
    ];
    expect(
      await generate.submit(McpToolName.SubmitDesignSection, {
        ...sectionInput,
        blocks: [...sectionInput.blocks, ...correctedBlocks],
      }),
    ).toEqual({
      isError: false,
      body: { remainingSectionIds: [entry.id] },
    });
    await updated;
    expect(t.app.services.attempts.get(generate.id).status).toBe(AttemptStatus.Running);
    expect(repo.listSections(designId)[0]?.blocks).toEqual([
      { type: 'diagram_ref', diagramId: repo.listDiagrams(designId)[0]?.id },
      ...correctedBlocks,
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

    const spotCheck = await work(AttemptKind.DesignReview, [overview.id, entry.id]);
    expect((await spotCheck.submit(McpToolName.SubmitDesignReview, { findings: [] })).isError).toBe(true);
    expect(
      await spotCheck.submit(McpToolName.SubmitDesignReview, {
        findings: [{ sectionId: overview.id, reviewState: DesignReviewState.Passed, notes: [] }],
      }),
    ).toEqual({ isError: false, body: { accepted: true } });
    expect(repo.listSections(designId).map(({ reviewState, reviewNotes }) => [reviewState, reviewNotes])).toEqual([
      [DesignReviewState.Passed, []],
      [DesignReviewState.None, null],
    ]);
  } finally {
    await mcp.close();
    db.close();
    await t.close();
  }
});

it('数据探索数据库元数据权限随连接撤销，并且复制模板不继承权限', async () => {
  const t = await createTestApp({ cipher: testCipher });
  const mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
  try {
    const { project, repo } = await addProject(t, { files: { 'schema.sql': 'CREATE TABLE orders (id INT);' } });
    const connection = await t.call(createDbConnectionOp, {
      name: 'orders',
      type: DbType.Mysql,
      host: '127.0.0.1',
      port: 3306,
      database: 'shop',
      username: 'readonly',
      password: '',
      tlsMode: DbTlsMode.Off,
    });
    expect(connection.status).toBe(201);
    const link = (connectionIds: string[]) => t.call(setProjectDbConnectionsOp, { id: project.id, connectionIds });
    expect((await link([connection.body.id])).status).toBe(200);

    const run = async (templateKey: string) => {
      const design = await t.call(createDesignOp, { projectId: project.id, templateKey, aiReviewEnabled: false });
      expect(design.status).toBe(201);
      t.fake.enqueue(script().hang(), { agent: OPENCODE_AGENT_NAME.designer });
      const started = await t.call(generateDesignOp, { id: design.body.id });
      expect(started.status).toBe(200);
      const attemptId = started.body.runs.at(-1)?.attempt.id;
      if (attemptId === undefined) throw new Error('Expected a design attempt');
      const { opencodeSessionId } = t.app.services.attempts.get(attemptId);
      if (opencodeSessionId === null) throw new Error('Expected an active design session');
      return {
        id: design.body.id,
        rules: await t.fake.sessionRules({ sessionId: opencodeSessionId, directory: repo.path }),
        call: (tool: McpToolName, input: Record<string, unknown> = {}) =>
          callTool(mcp, tool, { ...input, [MCP_SESSION_ARG]: opencodeSessionId }),
      };
    };

    const granted = await run(DATA_EXPLORER_KEY);
    expect(granted.rules).toContainEqual({
      permission: `${MCP_TOOL_PREFIX}${McpToolName.DbDescribe}`,
      action: 'allow',
      pattern: '*',
    });
    expect(await granted.call(McpToolName.DbListConnections)).toEqual({
      isError: false,
      body: { connections: [{ name: 'orders', type: DbType.Mysql, database: 'shop' }] },
    });
    const denied = { isError: true, body: { code: ErrorCode.McpToolNotAllowed } };
    expect((await link([])).status).toBe(200);
    expect(await granted.call(McpToolName.DbListConnections)).toMatchObject(denied);
    expect(await granted.call(McpToolName.DbDescribe, { connection: 'orders' })).toMatchObject(denied);
    expect((await t.call(stopDesignOp, { id: granted.id })).status).toBe(200);

    const sourceOnly = await run(DATA_EXPLORER_KEY);
    expect(
      sourceOnly.rules.some(({ permission }) => permission === `${MCP_TOOL_PREFIX}${McpToolName.DbDescribe}`),
    ).toBe(false);
    expect(await sourceOnly.call(McpToolName.DbListConnections)).toMatchObject(denied);
    expect((await t.call(stopDesignOp, { id: sourceOnly.id })).status).toBe(200);

    expect((await link([connection.body.id])).status).toBe(200);
    const templates = (await t.call(listDesignTemplatesOp, {})).body.items;
    const original = templates.find(({ key }) => key === DATA_EXPLORER_KEY);
    if (original === undefined) throw new Error('Expected the built-in data explorer template');
    const { name, description, defaultSections, focusPrompt } = original;
    const clone = await t.call(createDesignTemplateOp, {
      baseKey: original.key,
      name,
      description,
      defaultSections,
      focusPrompt,
    });
    expect(clone.status).toBe(201);
    const copied = await run(clone.body.key);
    expect(copied.rules.some(({ permission }) => permission === `${MCP_TOOL_PREFIX}${McpToolName.DbDescribe}`)).toBe(
      false,
    );
    expect(await copied.call(McpToolName.DbListConnections)).toMatchObject(denied);
    expect(await copied.call(McpToolName.DbDescribe, { connection: 'orders' })).toMatchObject(denied);
    expect((await t.call(stopDesignOp, { id: copied.id })).status).toBe(200);
  } finally {
    await mcp.close();
    await t.close();
  }
});
