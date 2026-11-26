import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DesignSectionKind, type DesignTemplate, TRANSACTION_EXPLORER_KEY } from '@aw/shared';

export const BuiltinDesignTemplateKey = { General: 'general', TransactionExplorer: TRANSACTION_EXPLORER_KEY } as const;
export type BuiltinDesignTemplateKey = (typeof BuiltinDesignTemplateKey)[keyof typeof BuiltinDesignTemplateKey];

export type BuiltinDesignTemplate = Omit<DesignTemplate, 'kind' | 'updatedAt'> & { key: BuiltinDesignTemplateKey };

const { Overview, Architecture, Module, Flow } = DesignSectionKind;
const blueprints: Omit<BuiltinDesignTemplate, 'focusPrompt'>[] = [
  {
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
  },
  {
    key: BuiltinDesignTemplateKey.TransactionExplorer,
    name: '交易链路探索',
    description: '按交易码、渠道和版本追踪报文，从入口查到处理步骤、字段流转、异常分支与账务边界。',
    matchHints: [],
    defaultSections: [
      { kind: Overview, title: '交易入口与路由', scopeHint: '.' },
      { kind: Flow, title: '交易档案与处理链路', scopeHint: '.' },
      { kind: DesignSectionKind.Custom, title: '字段流转与报文映射', scopeHint: '.' },
      { kind: DesignSectionKind.Custom, title: '异常处理与事务边界', scopeHint: '.' },
    ],
  },
];

export function loadBuiltinDesignTemplates(promptsDir: string): BuiltinDesignTemplate[] {
  return blueprints.map((blueprint) => ({
    ...blueprint,
    focusPrompt: readFileSync(join(promptsDir, 'design-templates', `${blueprint.key}.md`), 'utf8').trim(),
  }));
}
