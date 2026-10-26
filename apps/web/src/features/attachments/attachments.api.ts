import {
  API_PREFIX,
  ATTACHMENT_NAME_HEADER,
  type AttachmentDTO,
  AttachmentLimit,
  attachmentSchema,
  ErrorCode,
  errorResponseSchema,
  getAttachmentOp,
  previewAttachmentSheetOp,
  removeAttachmentOp,
  type SnapshotProjectFileRequest,
  snapshotProjectFileOp,
} from '@aw/shared';
import { queryOptions } from '@tanstack/react-query';
import { ApiError, apiToken, callOperation } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';
import { ATTACHMENTS_COPY as C } from '../../copy/attachments.ts';

async function failure(res: Response): Promise<ApiError> {
  return new ApiError(res.status, errorResponseSchema.parse(await res.json()).error);
}

/** One file as the raw request body (11 §14.1): the backend checks the bytes themselves (30 §3.1). */
export async function uploadAttachment(file: File): Promise<AttachmentDTO> {
  const res = await fetch(`${API_PREFIX}/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      'Content-Type': 'application/octet-stream',
      [ATTACHMENT_NAME_HEADER]: encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!res.ok) throw await failure(res);
  return attachmentSchema.parse(await res.json());
}

export const removeAttachment = (id: string) => callOperation(removeAttachmentOp, { id });

export const snapshotProjectFile = (input: SnapshotProjectFileRequest) => callOperation(snapshotProjectFileOp, input);

/** Picked files over the limit fail at once, as the backend would answer them. */
export const tooLargeError = (limit: number) =>
  new ApiError(413, {
    code: ErrorCode.AttachmentTooLarge,
    message: 'Attachment too large',
    details: { reason: AttachmentLimit.Bytes, limit },
  });

/** The precise message for a refused upload, by the error's `details.reason` (39 §8.1). */
export function failureMessage(error: unknown): string | undefined {
  const reason = error instanceof ApiError ? error.details?.reason : undefined;
  return typeof reason === 'string' ? C.failure[reason] : undefined;
}

export const attachmentSheetQuery = (id: string, sheet: string) =>
  queryOptions({
    queryKey: queryKeys.attachmentSheet(id, sheet),
    queryFn: () => callOperation(previewAttachmentSheetOp, { id, sheet }),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const attachmentQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.attachment(id),
    queryFn: () => callOperation(getAttachmentOp, { id }),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const attachmentContentQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.attachmentContent(id),
    queryFn: async () => {
      const res = await fetch(`${API_PREFIX}/attachments/${id}/content`, {
        headers: { Authorization: `Bearer ${apiToken()}` },
      });
      if (!res.ok) throw await failure(res);
      return res.text();
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
