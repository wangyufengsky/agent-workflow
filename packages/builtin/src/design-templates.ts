import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DesignSectionKind, type DesignTemplate } from '@aw/shared';

export const BuiltinDesignTemplateKey = {
  General: 'general',
  JavaBackend: 'java_backend',
  ReactFrontend: 'react_frontend',
  Fullstack: 'fullstack',
  AiAgent: 'ai_agent',
} as const;
export type BuiltinDesignTemplateKey = (typeof BuiltinDesignTemplateKey)[keyof typeof BuiltinDesignTemplateKey];

export type BuiltinDesignTemplate = Omit<DesignTemplate, 'kind' | 'updatedAt'> & { key: BuiltinDesignTemplateKey };
type TemplateDefinition = Omit<BuiltinDesignTemplate, 'focusPrompt'>;

const { Overview, Architecture, Module, Flow } = DesignSectionKind;
const overview = { kind: Overview, title: '项目总览', scopeHint: '.' };
const architecture = { kind: Architecture, title: '系统架构', scopeHint: '.' };

const definitions: TemplateDefinition[] = [
  {
    key: BuiltinDesignTemplateKey.General,
    name: '通用代码仓库',
    description: '梳理项目入口、模块职责、调用关系和主要业务流程。',
    matchHints: [],
    defaultSections: [
      overview,
      architecture,
      { kind: Module, title: '模块职责', scopeHint: '.' },
      { kind: Flow, title: '核心调用与业务流程', scopeHint: '.' },
    ],
  },
  {
    key: BuiltinDesignTemplateKey.JavaBackend,
    name: 'Java / Spring 后端',
    description: '追踪分层调用、接口、事务和数据库映射。',
    matchHints: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    defaultSections: [
      overview,
      { kind: Architecture, title: '分层架构', scopeHint: '.' },
      { kind: Module, title: '模块与数据访问', scopeHint: 'src/main' },
      { kind: Flow, title: '请求、事务与异常路径', scopeHint: 'src/main' },
    ],
  },
  {
    key: BuiltinDesignTemplateKey.ReactFrontend,
    name: 'React / Web 前端',
    description: '梳理路由页面、组件、客户端数据流及 API 契约。',
    matchHints: ['react', 'vite', 'next'],
    defaultSections: [
      overview,
      { kind: Architecture, title: '路由与页面架构', scopeHint: '.' },
      { kind: Module, title: '组件与状态管理', scopeHint: 'src' },
      { kind: Flow, title: '页面交互与数据流', scopeHint: 'src' },
    ],
  },
  {
    key: BuiltinDesignTemplateKey.Fullstack,
    name: '全栈应用',
    description: '呈现前后端、共享契约、数据模型与端到端流程。',
    matchHints: ['apps', 'packages', 'frontend', 'backend'],
    defaultSections: [
      overview,
      { kind: Architecture, title: '系统拓扑与部署边界', scopeHint: '.' },
      { kind: Module, title: '模块与共享契约', scopeHint: '.' },
      { kind: Flow, title: '端到端主链路', scopeHint: '.' },
    ],
  },
  {
    key: BuiltinDesignTemplateKey.AiAgent,
    name: 'AI Agent / 工具链',
    description: '解释角色、提示词、工具、上下文与权限边界。',
    matchHints: ['mcp', 'agents', 'prompts'],
    defaultSections: [
      overview,
      { kind: Architecture, title: '角色与会话架构', scopeHint: '.' },
      { kind: Module, title: '提示词与工具', scopeHint: '.' },
      { kind: Flow, title: '执行生命周期与权限边界', scopeHint: '.' },
    ],
  },
];

export function loadBuiltinDesignTemplates(promptsDir: string): BuiltinDesignTemplate[] {
  return definitions.map((definition) => ({
    ...definition,
    focusPrompt: readFileSync(join(promptsDir, 'design-templates', `${definition.key}.md`), 'utf8').trim(),
  }));
}
