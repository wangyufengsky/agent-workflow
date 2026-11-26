import { cp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AttemptKind,
  createDesignOp,
  createProjectOp,
  DesignDepth,
  DesignSectionKind,
  DesignStatus,
  exportDesignOp,
  generateDesignOp,
  getDesignOp,
  getRuntimeOp,
  InboxKind,
  InboxStatus,
  PermissionDecision,
  resolveInboxOp,
  reviseDesignOutlineOp,
  ServerEventType,
  TRANSACTION_EXPLORER_KEY,
  updateDesignOutlineOp,
  updateSettingsOp,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestApp } from '../packages/server/test/helpers/app.ts';
import { waitForEvent } from '../packages/server/test/helpers/events.ts';
import { createTestRepo } from '../packages/server/test/helpers/git.ts';
import { TEST_MODEL } from '../packages/server/test/helpers/model.ts';

const SENTINEL = 'aw-fixture-only-excluded-refund-value';

it.each([
  { templateKey: 'general', kind: DesignSectionKind.Module, title: '退款模块的关键函数、错误处理与调用关系' },
  { templateKey: TRANSACTION_EXPLORER_KEY, kind: DesignSectionKind.Flow, title: '退款交易档案与处理链路' },
])(
  '@live $templateKey generates evidence about the refund fixture and exports a self-contained site',
  async ({ templateKey, kind, title }) => {
    const t = await createTestApp({ realOpencode: true });
    try {
      await t.app.start(t.port);
      const { body: runtime } = await t.call(getRuntimeOp, {});
      expect(runtime.status, runtime.status === 'ready' ? undefined : JSON.stringify(runtime)).toBe('ready');
      await t.call(updateSettingsOp, { 'ai.defaultModel': TEST_MODEL });
      const repo = await createTestRepo();
      await cp(new URL('./fixtures/design-service/', import.meta.url), repo.path, { recursive: true });
      await repo.git('add', '-A');
      await repo.git('commit', '-qm', 'Add refund service');
      await writeFile(join(repo.path, '.env'), `PAYMENT_FIXTURE=${SENTINEL}\n`);
      const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
      const { body: created } = await t.call(createDesignOp, {
        projectId: project.id,
        depth: DesignDepth.Standard,
        templateKey,
      });
      expect(created.status).toBe(DesignStatus.OutlineReady);
      expect(created.files.map((file) => file.relPath)).toContain('src/退款规则.js');
      expect(JSON.stringify(created)).not.toContain('.env');
      const { body: outlined } = await t.call(updateDesignOutlineOp, {
        id: created.id,
        sections: [
          {
            kind,
            title,
            scopePaths: ['src'],
            selected: true,
          },
        ],
      });
      expect(outlined.totalSections).toBe(1);
      t.app.events.subscribe((event) => {
        if (event.type !== ServerEventType.InboxUpdated) return;
        const { item } = event.data;
        if (item.kind === InboxKind.Permission && item.status === InboxStatus.Open) {
          void t.call(resolveInboxOp, { id: item.id, response: { decision: PermissionDecision.Reject } });
        }
      });
      const ended = waitForEvent(
        t.app.events,
        ServerEventType.AttemptUpdated,
        (event) => event.attempt.kind === AttemptKind.DesignGenerate && event.attempt.endedAt !== null,
        20 * 60_000,
      );
      const [started, terminal] = await Promise.all([t.call(generateDesignOp, { id: created.id }), ended]);
      expect(started.status).toBe(200);
      expect(terminal.attempt.error).toBeNull();
      const { body: design } = await t.call(getDesignOp, { id: created.id });
      expect(design.status).toBe(DesignStatus.Ready);
      if (templateKey === TRANSACTION_EXPLORER_KEY) {
        const profiles = design.sections.flatMap(({ blocks }) =>
          (blocks ?? []).filter((block) => block.type === 'transaction'),
        );
        expect(profiles.length).toBeGreaterThan(0);
        for (const profile of profiles) {
          // 样例只有纯计算和外部网关调用，没有声明或开启资源事务。
          expect(profile.boundaries ?? []).toHaveLength(0);
          expect(design.diagrams.find(({ id }) => id === profile.diagramId)?.kind).toBe('business_flow');
        }
      }
      expect(design.files.flatMap((file) => file.symbols.map((symbol) => symbol.name))).toEqual(
        expect.arrayContaining(['dispatchRefund', 'refundableCents']),
      );
      expect(JSON.stringify(design)).not.toContain(SENTINEL);
      for (const { attempt } of design.runs) {
        expect(await readFile(join(t.dataDir, 'runs', 'designs', `${attempt.id}.jsonl`), 'utf8')).not.toContain(
          SENTINEL,
        );
      }
      const targetDir = join(t.dataDir, '中文 退款设计');
      const exported = await t.call(exportDesignOp, { id: design.id, targetDir });
      expect(exported.status).toBe(200);
      const html = await readFile(join(targetDir, 'index.html'), 'utf8');
      const links = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), ([, path]) => path);
      expect(links).toEqual(expect.arrayContaining(['design-data.js', 'assets/style.css', 'assets/viewer.js']));
      for (const path of links) {
        expect(path).not.toMatch(/^(?:[a-z]+:|\/|\.\.)/i);
        expect((await stat(join(targetDir, path))).isFile()).toBe(true);
      }
      const entries = await readdir(targetDir, { recursive: true, withFileTypes: true });
      for (const entry of entries.filter((entry) => entry.isFile())) {
        const data = await readFile(join(entry.parentPath, entry.name), 'utf8');
        expect(data).not.toContain(SENTINEL);
        expect(data).not.toContain('PAYMENT_FIXTURE');
      }
      const { sections, diagrams } = design;
      for (const block of sections.flatMap(({ blocks }) => blocks ?? [])) {
        if (block.type === 'diagram_ref') expect(diagrams.some(({ id }) => id === block.diagramId)).toBe(true);
      }
    } finally {
      await t.close();
    }
  },
);

it('@live AI plans the refund project and generates its chosen chapters without manual confirmation', async () => {
  const t = await createTestApp({ realOpencode: true });
  try {
    await t.app.start(t.port);
    const { body: runtime } = await t.call(getRuntimeOp, {});
    expect(runtime.status, runtime.status === 'ready' ? undefined : JSON.stringify(runtime)).toBe('ready');
    const repo = await createTestRepo();
    await cp(new URL('./fixtures/design-service/', import.meta.url), repo.path, { recursive: true });
    const { body: project } = await t.call(createProjectOp, { repoPath: repo.path });
    const { body: draft } = await t.call(createDesignOp, {
      projectId: project.id,
      templateKey: TRANSACTION_EXPLORER_KEY,
      depth: DesignDepth.Quick,
      aiReviewEnabled: false,
    });
    t.app.events.subscribe((event) => {
      if (
        event.type === ServerEventType.InboxUpdated &&
        event.data.item.kind === InboxKind.Permission &&
        event.data.item.status === InboxStatus.Open
      )
        void t.call(resolveInboxOp, { id: event.data.item.id, response: { decision: PermissionDecision.Reject } });
    });
    const finished = waitForEvent(
      t.app.events,
      ServerEventType.DesignUpdated,
      ({ designId }) => {
        if (designId !== draft.id) return false;
        const design = t.app.services.designs.get(designId);
        return design.status === DesignStatus.Ready || design.runs.at(-1)?.attempt.error != null;
      },
      20 * 60_000,
    );
    const [started] = await Promise.all([
      t.call(reviseDesignOutlineOp, { id: draft.id, generateAfterPlanning: true, model: TEST_MODEL }),
      finished,
    ]);
    expect(started.status).toBe(200);
    const { body: result } = await t.call(getDesignOp, { id: draft.id });
    expect(result.status, JSON.stringify(result.runs.map(({ attempt }) => attempt.error))).toBe(DesignStatus.Ready);
    expect(result.doneSections).toBeGreaterThan(0);
    expect(result.runs.map(({ kind }) => kind)).toEqual(['outline', ...result.sections.map(() => 'generate')]);
    expect(result.sections.some(({ blocks }) => blocks?.some(({ type }) => type === 'transaction'))).toBe(true);
  } finally {
    await t.close();
  }
});
