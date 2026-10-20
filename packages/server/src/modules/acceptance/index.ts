import { type AcceptanceServiceDeps, createAcceptanceService } from './acceptance.service.ts';

export type {
  AcceptanceService,
  CommandCheckResult,
  ReviewCheckResult,
  ReviewOutcome,
  ReviewRequest,
} from './acceptance.service.ts';

export function createAcceptanceModule(deps: AcceptanceServiceDeps) {
  return { service: createAcceptanceService(deps) };
}
