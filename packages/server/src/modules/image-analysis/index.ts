import { open } from 'node:fs/promises';
import { BuiltinRoleKey } from '@aw/builtin';
import {
  type AnalyzeImageOutput,
  AppError,
  ATTACHMENT_BYTES_MAX,
  ErrorCode,
  IMAGE_ANALYSIS_MAX_CHARS,
  IMAGE_ANALYSIS_TIMEOUT_MS,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import { type OpencodeClient, parseModelRef, type SessionDispatcher, SessionPurpose } from '../opencode/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';

type ImageSource = { path: string; mime: string; reference: AnalyzeImageOutput['source'] };

export function createImageAnalysis({
  clock,
  roles,
  settings,
  sessions,
  opencode,
}: {
  clock: Clock;
  roles: RolesService;
  settings: SettingsService;
  sessions: SessionDispatcher;
  opencode: OpencodeClient;
}) {
  async function analyze(
    source: ImageSource,
    question: string,
    requestSignal?: AbortSignal,
    delegatedFrom?: AbortSignal,
  ): Promise<AnalyzeImageOutput> {
    const configured = roles.getByKey(BuiltinRoleKey.ImageProcessor).model ?? settings.get('ai.defaultModel');

    const deadline = new AbortController();
    const cancelTimeout = clock.schedule(IMAGE_ANALYSIS_TIMEOUT_MS, () => deadline.abort());
    const signal = requestSignal === undefined ? deadline.signal : AbortSignal.any([deadline.signal, requestSignal]);
    try {
      const analysis = await sessions.callPrepared<string, { data: Buffer; model: ReturnType<typeof parseModelRef> }>(
        {
          purpose: SessionPurpose.Image,
          title: 'Image analysis',
          ...(delegatedFrom === undefined ? {} : { parentSignal: delegatedFrom }),
          signal,
        },
        (session, { data, model }) =>
          opencode.promptImage({
            ...session,
            model,
            question,
            image: { mime: source.mime, data },
          }),
        async (signal) => {
          const { available, defaultModel } = await opencode.listModels(undefined, signal);
          const ref = configured ?? defaultModel;
          if (!ref) throw new AppError(ErrorCode.ImageAnalysisUnavailable, 'Choose a role model with image input');
          const model = parseModelRef(ref);
          if (
            !available.some(
              (item) =>
                item.providerId === model.providerId && item.modelId === model.modelId && item.supportsImage === true,
            )
          ) {
            throw new AppError(
              ErrorCode.ImageAnalysisUnavailable,
              'The configured image model is unavailable or lacks image input',
            );
          }
          const file = await open(source.path, 'r');
          let data: Buffer;
          try {
            const stat = await file.stat();
            if (stat.size > ATTACHMENT_BYTES_MAX) {
              throw new AppError(ErrorCode.AttachmentTooLarge, 'This image exceeds the image reader limit', {
                limit: ATTACHMENT_BYTES_MAX,
              });
            }
            data = await file.readFile({ signal });
          } finally {
            await file.close();
          }
          return { data, model };
        },
      );
      signal.throwIfAborted();
      if (analysis === '') throw new AppError(ErrorCode.ImageAnalysisFailed, 'The image reader returned no analysis');
      return { source: source.reference, analysis: analysis.slice(0, IMAGE_ANALYSIS_MAX_CHARS) };
    } catch (err) {
      if (deadline.signal.aborted) throw new AppError(ErrorCode.ImageAnalysisFailed, 'Image analysis timed out');
      if (requestSignal?.aborted) throw new AppError(ErrorCode.ImageAnalysisFailed, 'Image analysis was cancelled');
      if (err instanceof AppError && err.code !== ErrorCode.OpencodeRequestFailed) throw err;
      throw new AppError(
        ErrorCode.ImageAnalysisFailed,
        'Could not read the image or get a response from the image model',
      );
    } finally {
      cancelTimeout();
    }
  }

  return { analyze };
}

export type ImageAnalysis = ReturnType<typeof createImageAnalysis>;
