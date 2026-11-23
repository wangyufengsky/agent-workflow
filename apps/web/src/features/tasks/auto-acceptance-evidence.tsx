import type { AcceptanceCheckKind, CheckResult } from '@aw/shared';
import { TASK_COPY as C } from '../../copy/tasks.ts';
import { noAutomaticCheck } from './skipped-checks.ts';

type CommandCheck = Extract<CheckResult, { kind: typeof AcceptanceCheckKind.Command }>;
type AutoCheck = {
  kind: CheckResult['kind'];
  skipped: boolean;
  command: string | null;
  autoSelection?: CommandCheck['autoSelection'];
};

export function autoAcceptanceLabel(check: AutoCheck): string | undefined {
  const { autoSelection } = check;
  if (autoSelection === undefined) return undefined;
  if (autoSelection.source === 'idea') return C.autoIdeaCheck;
  return noAutomaticCheck(check) ? C.autoNoCheck : C.autoFallbackCheck;
}

export function AutoAcceptanceEvidence({ check }: { check: AutoCheck }) {
  const { autoSelection } = check;
  const label = autoAcceptanceLabel(check);
  if (autoSelection === undefined) return null;
  return (
    <div className="col">
      <strong>{label}</strong>
      {autoSelection.source === 'idea' && autoSelection.configurations.length > 0 && (
        <ul>
          {[...new Set(autoSelection.configurations)].map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
      {autoSelection.source === 'fallback' && !noAutomaticCheck(check) && <code>{check.command}</code>}
      <p className="hint">{autoSelection.reason}</p>
    </div>
  );
}
