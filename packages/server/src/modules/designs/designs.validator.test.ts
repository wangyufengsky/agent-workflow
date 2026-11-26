import { mkdir, mkdtemp, rename, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DesignDiagramKind,
  DesignEvidenceClass,
  DesignReviewState,
  ErrorCode,
  type SubmitDesignReviewInput,
  type SubmitDesignSectionInput,
} from '@aw/shared';
import { expect, it } from 'vitest';
import { validateDesignOutline, validateDesignReview, validateDesignSection } from './designs.validator.ts';

const source = 'src/orders.ts';
const other = 'src/archive.ts';
const files = [{ relPath: source }];
const sectionId = 'orders';
const section: SubmitDesignSectionInput = { sectionId, summary: '订单流程', blocks: [], files: [], diagrams: [] };
const review: SubmitDesignReviewInput = {
  findings: [
    {
      sectionId,
      reviewState: DesignReviewState.NeedsAttention,
      notes: [{ severity: 'warn', message: '核对订单流程', relPath: source, lineStart: 2 }],
    },
  ],
};
const issue = (path: (string | number)[]) => ({
  code: ErrorCode.ValidationFailed,
  details: { issues: [{ path }] },
});

async function scopedProject() {
  const root = await mkdtemp(join(tmpdir(), 'design-validate-'));
  await mkdir(join(root, 'src'));
  await Promise.all([
    writeFile(join(root, source), 'const order = {}\r\nexport { order }\r\n'),
    writeFile(join(root, other), 'const archive = {}\n'),
  ]);
  return { root, files, targetSectionIds: [sectionId] };
}

it('大纲范围接受扫描目录与文件，拒绝扫描清单之外的路径', async () => {
  expect(() => validateDesignOutline([{ scopePaths: ['src', source] }], files)).not.toThrow();
  for (const path of ['src-extra', other, '../outside.ts', '/tmp/outside.ts']) {
    await expect(async () => validateDesignOutline([{ scopePaths: [path] }], files)).rejects.toMatchObject(
      issue(['sections', 0, 'scopePaths', 0]),
    );
  }
});

it('章节只允许本次目标和授权范围，证据行号按真实 CRLF 文件校验', async () => {
  const context = await scopedProject();
  const code = {
    type: 'code',
    language: 'typescript',
    code: 'export { order }',
    relPath: source,
    lineStart: 2,
    lineEnd: 2,
  } as const;
  await expect(validateDesignSection({ ...section, blocks: [code] }, context)).resolves.toBeUndefined();
  await expect(validateDesignSection({ ...section, sectionId: 'other' }, context)).rejects.toMatchObject(
    issue(['sectionId']),
  );
  await expect(
    validateDesignSection({ ...section, blocks: [{ ...code, relPath: other }] }, context),
  ).rejects.toMatchObject(issue(['blocks', 0, 'lineEnd']));
  for (const lineEnd of [1, 3]) {
    await expect(validateDesignSection({ ...section, blocks: [{ ...code, lineEnd }] }, context)).rejects.toMatchObject(
      issue(['blocks', 0, 'lineEnd']),
    );
  }
});

it('关系图验证端点、静态证据和显式业务重试自环', async () => {
  const context = await scopedProject();
  const inferred = {
    id: 'retry-edge',
    from: 'order',
    to: 'order',
    kind: 'retry',
    evidenceClass: DesignEvidenceClass.Inferred,
    rationale: '待执行任务可重试',
  };
  const confirmed = {
    id: 'read-edge',
    from: 'order',
    to: 'store',
    kind: 'read',
    evidenceClass: DesignEvidenceClass.Static,
    evidencePath: source,
    lineStart: 1,
    lineEnd: 2,
  };
  const diagram = {
    id: 'checkout',
    kind: DesignDiagramKind.BusinessFlow,
    title: '结算',
    nodes: [
      { id: 'order', label: '订单' },
      { id: 'store', label: '订单存储' },
    ],
    edges: [inferred, confirmed],
  };
  await expect(validateDesignSection({ ...section, diagrams: [diagram] }, context)).resolves.toBeUndefined();

  const validate = (edges: typeof diagram.edges, kind: DesignDiagramKind = diagram.kind) =>
    validateDesignSection({ ...section, diagrams: [{ ...diagram, kind, edges }] }, context);
  await expect(validate([{ ...inferred, to: 'unknown' }])).rejects.toMatchObject(
    issue(['diagrams', 0, 'edges', 0, 'to']),
  );
  await expect(validate([{ ...inferred, kind: 'read' }])).rejects.toMatchObject(
    issue(['diagrams', 0, 'edges', 0, 'to']),
  );
  await expect(validate([inferred], DesignDiagramKind.CallGraph)).rejects.toMatchObject(
    issue(['diagrams', 0, 'edges', 0, 'to']),
  );
  await expect(validate([{ ...confirmed, lineEnd: 3 }])).rejects.toMatchObject(
    issue(['diagrams', 0, 'edges', 0, 'lineEnd']),
  );
});

it('复审只允许本次目标与授权源码中的位置', async () => {
  const context = await scopedProject();
  await expect(validateDesignReview(review, context)).resolves.toBeUndefined();
  await expect(validateDesignReview(review, { ...context, targetSectionIds: [] })).rejects.toMatchObject(
    issue(['findings', 0, 'sectionId']),
  );
  const finding = (relPath: string, lineStart: number): SubmitDesignReviewInput => ({
    findings: [
      {
        sectionId,
        reviewState: DesignReviewState.NeedsAttention,
        notes: [{ severity: 'warn', message: '核对订单流程', relPath, lineStart }],
      },
    ],
  });
  await expect(validateDesignReview(finding('../bad.ts', 2), context)).rejects.toMatchObject(
    issue(['findings', 0, 'notes', 0, 'relPath']),
  );
  await expect(validateDesignReview(finding(source, 3), context)).rejects.toMatchObject(
    issue(['findings', 0, 'notes', 0, 'lineStart']),
  );
});

it('复审仅引用文件时也拒绝扫描后替换为敏感文件的符号链接', async () => {
  const context = await scopedProject();
  const secret = join(context.root, '.env');
  await rename(join(context.root, source), secret);
  await symlink(secret, join(context.root, source), 'file');
  await expect(
    validateDesignReview(
      {
        findings: [
          {
            sectionId,
            reviewState: DesignReviewState.NeedsAttention,
            notes: [{ severity: 'warn', message: '核对订单流程', relPath: source }],
          },
        ],
      },
      context,
    ),
  ).rejects.toMatchObject(issue(['findings', 0, 'notes', 0, 'relPath']));
});

it('子模块引用本章的文件；每项功能的静态证据须指向真实源码范围', async () => {
  const context = await scopedProject();
  const block = {
    type: 'submodule',
    id: 'order',
    title: '订单',
    summary: '导出订单',
    files: [source],
    behaviors: [
      {
        title: '读取订单',
        markdown: '向调用方提供订单。',
        evidence: [{ evidenceClass: DesignEvidenceClass.Static, relPath: source, lineStart: 1, lineEnd: 2 }],
      },
    ],
  } as const;
  const behavior = { ...block.behaviors[0], evidence: [...block.behaviors[0].evidence] };
  const submodule = { ...block, files: [source], behaviors: [behavior] };
  const submitted = { ...section, files: [{ relPath: source, responsibility: '导出订单', symbols: [] }] };
  await expect(validateDesignSection({ ...submitted, blocks: [submodule] }, context)).resolves.toBeUndefined();
  await expect(validateDesignSection({ ...section, blocks: [submodule] }, context)).rejects.toMatchObject(
    issue(['blocks', 0, 'files', 0]),
  );
  await expect(
    validateDesignSection({ ...submitted, blocks: [submodule, { ...submodule, id: 'other' }] }, context),
  ).rejects.toMatchObject(issue(['blocks', 1, 'files', 0]));
  await expect(
    validateDesignSection(
      {
        ...submitted,
        blocks: [
          { ...submodule, behaviors: [{ ...behavior, evidence: [{ ...block.behaviors[0].evidence[0], lineEnd: 3 }] }] },
        ],
      },
      context,
    ),
  ).rejects.toMatchObject(issue(['blocks', 0, 'behaviors', 0, 'evidence', 0]));
});

it('每个交易档案引用本章独立的非空业务流程图并校验档案证据', async () => {
  const context = await scopedProject();
  const diagram = {
    id: 'refund',
    kind: DesignDiagramKind.BusinessFlow,
    title: '退款',
    nodes: [{ id: 'entry', label: '入口' }],
    edges: [],
  };
  const evidence = { evidenceClass: DesignEvidenceClass.Static, relPath: source, lineStart: 1, lineEnd: 1 };
  const profile = { type: 'transaction' as const, title: '退款', diagramId: diagram.id, evidence: [evidence] };
  const input = { ...section, diagrams: [diagram], blocks: [profile] };
  await expect(validateDesignSection(input, context)).resolves.toBeUndefined();
  for (const key of ['fields', 'boundaries'] as const) {
    const trace = { name: '订单号', steps: ['other'], description: '随请求传入', evidence: [evidence] };
    await expect(
      validateDesignSection({ ...input, blocks: [{ ...profile, [key]: [trace] }] }, context),
    ).rejects.toMatchObject(issue(['blocks', 0, key, 0, 'steps', 0]));
  }
  for (const diagrams of [[], [{ ...diagram, nodes: [] }], [{ ...diagram, kind: DesignDiagramKind.Architecture }]]) {
    await expect(validateDesignSection({ ...input, diagrams }, context)).rejects.toMatchObject(
      issue(['blocks', 0, 'diagramId']),
    );
  }
  await expect(validateDesignSection({ ...input, blocks: [profile, profile] }, context)).rejects.toMatchObject(
    issue(['blocks', 1, 'diagramId']),
  );
  await expect(
    validateDesignSection({ ...input, blocks: [{ ...profile, evidence: [{ ...evidence, lineEnd: 99 }] }] }, context),
  ).rejects.toMatchObject(issue(['blocks', 0, 'evidence', 0]));
});
