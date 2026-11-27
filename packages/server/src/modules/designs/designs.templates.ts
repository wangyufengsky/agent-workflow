import { randomUUID } from 'node:crypto';
import type { BuiltinDesignTemplate } from '@aw/builtin';
import {
  AppError,
  type AttemptKind,
  type CreateDesignTemplateRequest,
  DATA_EXPLORER_KEY,
  DESIGN_DATABASE_METADATA_KINDS,
  type DesignTemplate,
  DesignTemplateKind,
  designTemplateSchema,
  ErrorCode,
  type ListDesignTemplatesQuery,
  type ListDesignTemplatesResponse,
  type UpdateDesignTemplateRequest,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { ProjectsService } from '../projects/index.ts';
import { inspectDesignProject } from './designs.features.ts';
import type { createDesignsRepo, ProjectDesign } from './designs.repo.ts';

/** 内置键由应用注册，复制模板会分配新的键。 */
export function isDataExplorerSectionRun(kind: AttemptKind, design: ProjectDesign): boolean {
  return design.templateKey === DATA_EXPLORER_KEY && DESIGN_DATABASE_METADATA_KINDS.some((item) => item === kind);
}

export function syncBuiltinDesignTemplates(
  repo: ReturnType<typeof createDesignsRepo>,
  unit: UnitOfWork,
  clock: Clock,
  seeds: readonly BuiltinDesignTemplate[],
): void {
  const now = clock.now();
  const keys = new Set<string>(seeds.map((seed) => seed.key));
  unit.transact(() => {
    for (const seed of seeds) {
      const template = designTemplateSchema.parse({ ...seed, kind: DesignTemplateKind.Builtin, updatedAt: now });
      repo.upsertTemplate(template);
    }
    for (const template of repo.listTemplates()) {
      if (template.kind === DesignTemplateKind.Builtin && !keys.has(template.key)) {
        repo.deleteTemplate(template.key);
      }
    }
  });
}

type DesignTemplateDeps = {
  repo: ReturnType<typeof createDesignsRepo>;
  projects: Pick<ProjectsService, 'getRecord'>;
  clock: Clock;
  unit: UnitOfWork;
};

export function createDesignTemplates({ repo, projects, clock, unit }: DesignTemplateDeps) {
  function requireTemplate(key: string): DesignTemplate {
    const template = repo.findTemplate(key);
    if (template === undefined)
      throw new AppError(ErrorCode.DesignNotFound, 'Design template not found', { templateKey: key });
    return template;
  }

  function requireCustomTemplate(key: string): DesignTemplate {
    const template = requireTemplate(key);
    if (template.kind === DesignTemplateKind.Builtin) {
      throw new AppError(ErrorCode.DesignTemplateReadonly, 'Built-in templates cannot be changed', {
        templateKey: key,
      });
    }
    return template;
  }

  return {
    async listTemplates({ projectId }: ListDesignTemplatesQuery): Promise<ListDesignTemplatesResponse> {
      const suggested =
        projectId === undefined ? null : await inspectDesignProject(projects.getRecord(projectId).repoPath);
      return { items: repo.listTemplates(), suggested };
    },

    createTemplate({ baseKey, ...fields }: CreateDesignTemplateRequest): DesignTemplate {
      return unit.transact(() => {
        const matchHints = baseKey === undefined ? [] : requireTemplate(baseKey).matchHints;
        const template: DesignTemplate = {
          ...fields,
          key: randomUUID(),
          kind: DesignTemplateKind.Custom,
          matchHints,
          updatedAt: clock.now(),
        };
        repo.upsertTemplate(template);
        return template;
      });
    },

    updateTemplate({
      key,
      name,
      description,
      defaultSections,
      focusPrompt,
    }: UpdateDesignTemplateRequest): DesignTemplate {
      return unit.transact(() => {
        const previous = requireCustomTemplate(key);
        const template: DesignTemplate = {
          ...previous,
          name: name ?? previous.name,
          description: description ?? previous.description,
          defaultSections: defaultSections ?? previous.defaultSections,
          focusPrompt: focusPrompt ?? previous.focusPrompt,
          updatedAt: clock.now(),
        };
        repo.upsertTemplate(template);
        return template;
      });
    },

    deleteTemplate(key: string): void {
      unit.transact(() => {
        requireCustomTemplate(key);
        repo.deleteTemplate(key);
      });
    },
  };
}
