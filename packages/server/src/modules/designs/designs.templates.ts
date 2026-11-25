import type { BuiltinDesignTemplate } from '@aw/builtin';
import { DesignTemplateKind, designTemplateSchema } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { createDesignsRepo } from './designs.repo.ts';

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
