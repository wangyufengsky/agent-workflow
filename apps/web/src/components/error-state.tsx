import { ErrorCode, errorInfoSchema, MasterPasswordState, unlockCredentialsOp } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type ReactNode, useState } from 'react';
import { ApiError, callOperation } from '../api/client.ts';
import { COMMON_COPY } from '../copy/common.ts';
import { ERROR_COPY } from '../copy/errors.ts';
import { ONBOARDING_COPY } from '../copy/onboarding.ts';
import { environmentQuery, useCredentialMutation } from '../features/onboarding/environment.queries.ts';
import { Button } from './button.tsx';
import { Icon } from './icon.tsx';
import { toast } from './toast.tsx';

const C = ONBOARDING_COPY.credentials;

/**
 * One way to show a failure (06 §8): the code's message, technical details folded away. Takes a failed request or
 * an `ErrorInfo` recorded on a task, delivery or attempt.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const info = error instanceof ApiError ? error : errorInfoSchema.safeParse(error).data;
  const message = info === undefined ? COMMON_COPY.backendUnreachable : ERROR_COPY[info.code];
  const detail = error instanceof Error ? error.message : (info?.message ?? String(error));
  return (
    <div className="banner danger" role="alert">
      <Icon name="alert" />
      <div className="grow col">
        <span>{message}</span>
        {info?.code === ErrorCode.CredentialLocked && <UnlockForm />}
        <details>
          <summary className="hint">{COMMON_COPY.errorDetails}</summary>
          <pre className="mono hint">{detail}</pre>
        </details>
      </div>
      {onRetry !== undefined && (
        <Button size="sm" onClick={onRetry}>
          {COMMON_COPY.retry}
        </Button>
      )}
    </div>
  );
}

/**
 * Entering the master password where it is missing (D167, D178): the environment checks, the shell's banner and any
 * `CREDENTIAL_LOCKED` failure. It lives with ErrorState, which shows it and which it uses for its own failure.
 */
export function UnlockForm({ children }: { children?: ReactNode }) {
  const [password, setPassword] = useState('');
  const { data: environment } = useQuery(environmentQuery);
  const unlock = useCredentialMutation((p: string) => callOperation(unlockCredentialsOp, { password: p }));
  if (environment !== undefined && environment.credentials.masterPassword !== MasterPasswordState.Locked) {
    return <span className="hint">{C.unlockedRetry}</span>;
  }
  const submit = () => unlock.mutate(password, { onSuccess: () => toast(C.unlockDone) });
  // Not a form: the error this sits under is often inside the form that failed, which a nested submit would send
  // again. Enter would submit that form implicitly, so it unlocks here instead.
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (password !== '') submit();
  };
  return (
    <fieldset className="col" aria-label={C.unlock}>
      <div className="row wrap">
        <input
          className="input unlock-input"
          type="password"
          autoComplete="off"
          aria-label={C.password}
          placeholder={C.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button size="sm" pending={unlock.isPending} disabled={password === ''} onClick={submit}>
          {C.unlock}
        </Button>
        {children}
      </div>
      {unlock.isError && <ErrorState error={unlock.error} />}
    </fieldset>
  );
}
