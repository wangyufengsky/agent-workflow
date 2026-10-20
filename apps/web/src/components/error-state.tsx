import { errorInfoSchema } from '@aw/shared';
import { ApiError } from '../api/client.ts';
import { COMMON_COPY } from '../copy/common.ts';
import { ERROR_COPY, GENERIC_ERROR } from '../copy/errors.ts';
import { Button } from './button.tsx';
import { Icon } from './icon.tsx';

/**
 * One way to show a failure (06 §8): the code's message, technical details folded away. Takes a failed request or
 * an `ErrorInfo` recorded on a task, delivery or attempt.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const info = error instanceof ApiError ? error : errorInfoSchema.safeParse(error).data;
  const message =
    info === undefined ? COMMON_COPY.backendUnreachable : (ERROR_COPY[info.code] ?? `${GENERIC_ERROR}（${info.code}）`);
  const detail = error instanceof Error ? error.message : (info?.message ?? String(error));
  return (
    <div className="banner danger" role="alert">
      <Icon name="alert" />
      <div className="grow col">
        <span>{message}</span>
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
