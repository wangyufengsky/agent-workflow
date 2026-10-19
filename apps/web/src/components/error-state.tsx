import { ApiError } from '../api/client.ts';
import { COMMON_COPY } from '../copy/common.ts';
import { ERROR_COPY, GENERIC_ERROR } from '../copy/errors.ts';
import { Button } from './button.tsx';
import { Icon } from './icon.tsx';

/** One way to show a failed load (06 §8): the code's message, technical details folded away. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError
      ? (ERROR_COPY[error.code] ?? `${GENERIC_ERROR}（${error.code}）`)
      : COMMON_COPY.backendUnreachable;
  return (
    <div className="banner danger" role="alert">
      <Icon name="alert" />
      <div className="grow col">
        <span>{message}</span>
        <details>
          <summary className="hint">{COMMON_COPY.errorDetails}</summary>
          <pre className="mono hint">{error instanceof Error ? error.message : String(error)}</pre>
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
