import {
  API_PREFIX,
  type BrowserFrame,
  getPreviewOp,
  listBrowserFramesOp,
  listPreviewSessionsOp,
  PreviewState,
  userTabLogsOp,
} from '@aw/shared';
import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query';
import { callOperation, getBlob } from '../../api/client.ts';
import { queryKeys } from '../../api/query-keys.ts';

/** The task's preview; its log tail grows only while it starts, so that is when it is read again (29 §8.1). */
export const previewQuery = (taskId: string) =>
  queryOptions({
    queryKey: queryKeys.preview(taskId),
    queryFn: () => callOperation(getPreviewOp, { taskId }),
    refetchInterval: (query) => (query.state.data?.state === PreviewState.Starting ? 1000 : false),
  });

export const previewSessionsQuery = (taskId: string) =>
  queryOptions({
    queryKey: queryKeys.previewSessions(taskId),
    queryFn: () => callOperation(listPreviewSessionsOp, { id: taskId }),
  });

export const framesQuery = (attemptId: string) =>
  queryOptions({
    queryKey: queryKeys.browserFrames(attemptId),
    queryFn: async () => (await callOperation(listBrowserFramesOp, { attemptId })).items,
  });

export const userTabLogsQuery = (tabId: string) =>
  queryOptions({ queryKey: queryKeys.userTabLogs(tabId), queryFn: () => callOperation(userTabLogsOp, { tabId }) });

/** `browser.frame`: the frame joins its attempt's list, and a first frame makes the attempt a session. */
export async function appendFrame(qc: QueryClient, frame: BrowserFrame): Promise<void> {
  qc.setQueryData<BrowserFrame[]>(queryKeys.browserFrames(frame.attemptId), (frames) =>
    frames === undefined || frames.some((f) => f.seq === frame.seq) ? frames : [...frames, frame],
  );
  if (frame.taskId !== null) await qc.invalidateQueries({ queryKey: queryKeys.previewSessions(frame.taskId) });
}

/** An attempt's screenshot or frame. */
export const attemptFileUrl = (attemptId: string, file: string) =>
  `${API_PREFIX}/attempts/${encodeURIComponent(attemptId)}/browser/${file}`;
/** A page check's screenshot. */
export const taskFileUrl = (taskId: string, file: string) =>
  `${API_PREFIX}/tasks/${encodeURIComponent(taskId)}/browser/${file}`;

/** A blob as a `data:` URL, which the browser frees with the string (an object URL would need revoking). */
const dataUrlOf = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * An image of the API for `<img src>`, which cannot send the token. Images never change once written, so each is read
 * once and kept while shown.
 */
export function useImage(url: string): string | null {
  const image = useQuery({
    queryKey: ['images', url],
    queryFn: async () => dataUrlOf(await getBlob(url)),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return image.data ?? null;
}
