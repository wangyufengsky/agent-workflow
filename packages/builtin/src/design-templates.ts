import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DesignSectionKind, type DesignTemplate } from '@aw/shared';

export const BuiltinDesignTemplateKey = { General: 'general' } as const;
export type BuiltinDesignTemplateKey = (typeof BuiltinDesignTemplateKey)[keyof typeof BuiltinDesignTemplateKey];

export type BuiltinDesignTemplate = Omit<DesignTemplate, 'kind' | 'updatedAt'> & { key: BuiltinDesignTemplateKey };

const { Overview, Architecture, Module, Flow } = DesignSectionKind;
const blueprint: Omit<BuiltinDesignTemplate, 'focusPrompt'> = {
  // 保留原有通用模板键。已有设计使用创建时的模板快照。
  key: BuiltinDesignTemplateKey.General,
  name: '架构探索',
  description: '从项目到模块、文件与符号，梳理组成和有源码依据的依赖关系。',
  matchHints: [],
  defaultSections: [
    { kind: Overview, title: '项目总览', scopeHint: '.' },
    { kind: Architecture, title: '总体架构', scopeHint: '.' },
    { kind: Module, title: '模块组成', scopeHint: '.' },
    { kind: Flow, title: '关键调用与流程', scopeHint: '.' },
  ],
};

export function loadBuiltinDesignTemplates(promptsDir: string): BuiltinDesignTemplate[] {
  const focusPrompt = readFileSync(join(promptsDir, 'design-templates', `${blueprint.key}.md`), 'utf8').trim();
  return [{ ...blueprint, focusPrompt }];
}
