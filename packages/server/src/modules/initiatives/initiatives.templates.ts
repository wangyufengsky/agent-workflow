import { randomUUID } from 'node:crypto';
import type { BuiltinInitiativeTemplate } from '@aw/builtin';
import {
  AppError,
  ErrorCode,
  type InitiativeDraft,
  type InitiativeTemplateDTO,
  InitiativeTemplateKind,
  type SaveInitiativeTemplateRequest,
  saveInitiativeTemplateRequestSchema,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { createInitiativesRepo, InitiativeTemplate } from './initiatives.repo.ts';

const toDTO = ({ id: _id, ...template }: InitiativeTemplate): InitiativeTemplateDTO => template;

/**
 * Composition templates (34 §15): the built-in ones are written on every start, custom ones by the user (34 §15.6);
 * both in place, with no versions — initiatives keep a copy of what they were made from.
 */
export function createInitiativeTemplates(
  repo: ReturnType<typeof createInitiativesRepo>,
  unit: UnitOfWork,
  clock: Clock,
  /** Throws INITIATIVE_BREAKDOWN_INVALID unless the phases and work packages pass as a template's. */
  checkTemplate: (draft: InitiativeDraft) => void,
) {
  const find = (key: string) => repo.templates().find((t) => t.key === key);
  function get(key: string): InitiativeTemplate {
    const template = find(key);
    if (template === undefined) {
      throw new AppError(ErrorCode.InitiativeTemplateNotFound, `Composition template ${key} not found`, { key });
    }
    return template;
  }
  function custom(key: string): InitiativeTemplate {
    const template = get(key);
    if (template.kind === InitiativeTemplateKind.Builtin) {
      throw new AppError(ErrorCode.InitiativeTemplateReadonly, `Composition template ${key} is built in`, { key });
    }
    return template;
  }
  /** Custom templates are listed after the built-in ones, in the order they were made (position 0). */
  function write(input: SaveInitiativeTemplateRequest, id: string): InitiativeTemplateDTO {
    const template = saveInitiativeTemplateRequestSchema.parse(input);
    checkTemplate(template);
    repo.upsertTemplate({ ...template, id, kind: InitiativeTemplateKind.Custom }, 0, clock.now());
    return toDTO(get(template.key));
  }

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
    get,
    create(input: SaveInitiativeTemplateRequest): InitiativeTemplateDTO {
      return unit.transact(() => {
        if (find(input.key) !== undefined) {
          throw new AppError(ErrorCode.InitiativeTemplateAlreadyExists, `Composition template ${input.key} exists`, {
            key: input.key,
          });
        }
        return write(input, randomUUID());
      });
    },
    update(input: SaveInitiativeTemplateRequest): InitiativeTemplateDTO {
      return unit.transact(() => write(input, custom(input.key).id));
    },
    delete(key: string): void {
      unit.transact(() => repo.deleteTemplate(custom(key).key));
    },
  };
}
