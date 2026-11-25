import { describe, expect, it } from 'vitest';
import { DesignDiagramKind, DesignEvidenceClass, DesignSectionKind } from '../../enums/design.ts';
import { designOutlineSectionSchema } from '../design/template.ts';
import { submitDesignOutlineInputSchema, submitDesignSectionInputSchema } from './design-tools.ts';

describe('项目设计提交契约', () => {
  it('默认选中手工大纲中的章节并拒绝越界路径', () => {
    const section = { kind: DesignSectionKind.Module, title: '服务端', scopePaths: ['packages/server'] };
    expect(designOutlineSectionSchema.parse(section).selected).toBe(true);
    expect(designOutlineSectionSchema.parse({ ...section, selected: false }).selected).toBe(false);
    expect(
      submitDesignOutlineInputSchema.safeParse({ sections: [{ ...section, scopePaths: ['../server'] }] }).success,
    ).toBe(false);
  });

  it('要求静态图边附源码位置，允许有理由的推断边', () => {
    const diagram = {
      id: 'calls',
      kind: DesignDiagramKind.CallGraph,
      title: '调用关系',
      nodes: [
        { id: 'router', label: '路由' },
        { id: 'service', label: '服务' },
      ],
    };
    const edge = { id: 'edge', from: 'router', to: 'service', kind: 'calls' };
    const submit = (relation: unknown) =>
      submitDesignSectionInputSchema.safeParse({
        sectionId: 'architecture',
        summary: '请求调用链',
        blocks: [{ type: 'diagram_ref', diagramId: diagram.id }],
        files: [],
        diagrams: [{ ...diagram, edges: [relation] }],
      }).success;

    expect(submit({ ...edge, evidenceClass: DesignEvidenceClass.Static })).toBe(false);
    expect(submit({ ...edge, evidenceClass: DesignEvidenceClass.Inferred })).toBe(false);
    expect(submit({ ...edge, evidenceClass: DesignEvidenceClass.Inferred, rationale: '运行时注册' })).toBe(true);
    expect(
      submit({
        ...edge,
        evidenceClass: DesignEvidenceClass.Static,
        evidencePath: 'src/router.ts',
        lineStart: 12,
        lineEnd: 14,
      }),
    ).toBe(true);
  });
});
