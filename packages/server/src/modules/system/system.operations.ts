import {
  getEnvironmentOp,
  getHealthOp,
  getRuntimeLogsOp,
  getRuntimeOp,
  recheckEnvironmentOp,
  restartRuntimeOp,
} from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { SystemService } from './system.service.ts';

export function systemOperations(system: SystemService) {
  return [
    implement(getHealthOp, () => system.health()),
    implement(getEnvironmentOp, () => system.environment()),
    implement(recheckEnvironmentOp, () => system.recheck()),
    implement(getRuntimeOp, () => system.runtime()),
    implement(restartRuntimeOp, () => system.restartRuntime()),
    implement(getRuntimeLogsOp, ({ tail }) => system.runtimeLogs(tail)),
  ];
}
