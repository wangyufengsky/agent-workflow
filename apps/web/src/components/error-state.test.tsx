import { ErrorCode } from '@aw/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client.ts';
import { ErrorState } from './error-state.tsx';

describe('ErrorState', () => {
  it("shows the database's own message in the technical details", () => {
    const error = new ApiError(400, {
      code: ErrorCode.DbQueryFailed,
      message: 'The statement failed',
      details: { driverMessage: 'permission denied for relation pg_class' },
    });
    const out = renderToStaticMarkup(<ErrorState error={error} />);
    expect(out).toContain('The statement failed');
    expect(out).toContain('permission denied for relation pg_class');
  });
});
