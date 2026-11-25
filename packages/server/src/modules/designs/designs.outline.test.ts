import { DESIGN_MAX_SECTIONS, DesignSectionKind, type DesignTemplateSection } from '@aw/shared';
import { expect, it } from 'vitest';
import { initialDesignOutline } from './designs.outline.ts';

const blueprint: DesignTemplateSection[] = [
  { kind: DesignSectionKind.Overview, title: '总览', scopeHint: 'package.json' },
  { kind: DesignSectionKind.Module, title: '模块', scopeHint: '' },
  { kind: DesignSectionKind.Flow, title: '流程', scopeHint: 'apps/server' },
];

it('按模板顺序展开扫描到的实际模块并保留选中状态', () => {
  const files = ['apps/web/index.ts', 'apps/server/index.ts', 'package.json', 'apps/server/handler.ts'].map(
    (relPath) => ({ relPath }),
  );
  expect(initialDesignOutline(blueprint, files)).toEqual([
    { kind: DesignSectionKind.Overview, title: '总览', scopePaths: ['package.json'], selected: true },
    {
      kind: DesignSectionKind.Module,
      title: '模块 · apps/server',
      scopePaths: ['apps/server'],
      selected: true,
    },
    { kind: DesignSectionKind.Module, title: '模块 · apps/web', scopePaths: ['apps/web'], selected: true },
    { kind: DesignSectionKind.Flow, title: '流程', scopePaths: ['apps/server'], selected: true },
  ]);
});

it('模块超过章节上限时保留全部模块范围和模板中的流程章节', () => {
  const paths = Array.from({ length: DESIGN_MAX_SECTIONS + 5 }, (_, i) => `packages/module-${i}`);
  const outline = initialDesignOutline(
    blueprint,
    paths.map((path) => ({ relPath: `${path}/index.ts` })),
  );
  expect(outline).toHaveLength(DESIGN_MAX_SECTIONS);
  expect(outline.at(-1)).toMatchObject({ kind: DesignSectionKind.Flow, title: '流程' });
  const scopes = outline
    .filter((section) => section.kind === DesignSectionKind.Module)
    .flatMap((section) => section.scopePaths);
  expect(scopes.sort()).toEqual(paths.sort());
});
