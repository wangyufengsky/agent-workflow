import { startDebugAttemptOp } from '@aw/shared';
import { implement } from '../../core/operations/operations.ts';
import type { DebugService } from './debug.service.ts';

export function debugOperations(debug: DebugService) {
  return [implement(startDebugAttemptOp, (input) => debug.start(input))];
}
