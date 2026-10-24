import { randomUUID } from 'node:crypto';
import type { BuiltinInitiativeTemplate } from '@aw/builtin';
import { AppError, ErrorCode, type InitiativeTemplateDTO, InitiativeTemplateKind } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { createInitiativesRepo, InitiativeTemplate } from './initiatives.repo.ts';

const toDTO = ({ id: _id, ...template }: InitiativeTemplate): InitiativeTemplateDTO => template;

/** Composition templates (34 §15): the built-in ones are written on every start, in place (no versions). */
export function createInitiativeTemplates(
  repo: ReturnType<typeof createInitiativesRepo>,
  unit: UnitOfWork,
  clock: Clock,
) {
  return {
    syncBuiltin(seeds: readonly BuiltinInitiativeTemplate[]): void {
      const now = clock.now();
      unit.transact(() => {
        seeds.forEach((seed, position) => {
          repo.upsertTemplate({ ...seed, id: randomUUID(), kind: InitiativeTemplateKind.Builtin }, position, now);
        });
        // Initiatives keep their snapshot; one made from a removed template loses only its header link.
        const keys = new Set(seeds.map((s) => s.key));
        for (const template of repo.templates()) {
          if (template.kind === InitiativeTemplateKind.Builtin && !keys.has(template.key)) {
            repo.deleteTemplate(template.key);
          }
        }
      });
    },
    list: (): InitiativeTemplateDTO[] => repo.templates().map(toDTO),
    get(key: string): InitiativeTemplate {
      const template = repo.templates().find((t) => t.key === key);
      if (template === undefined) {
        throw new AppError(ErrorCode.InitiativeTemplateNotFound, `Composition template ${key} not found`, { key });
      }
      return template;
    },
  };
}
