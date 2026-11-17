import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AnalyzeImageOutput,
  AppError,
  ATTACHMENT_BYTES_MAX,
  ErrorCode,
  IMAGE_ANALYSIS_MAX_CHARS,
  IMAGE_ANALYSIS_TIMEOUT_MS,
  OPENCODE_IMAGE_AGENT,
} from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { ModelSlots } from '../model-slots/index.ts';
import { type OpencodeClient, parseModelRef } from '../opencode/index.ts';
import type { SettingsService } from '../settings/index.ts';

type ImageSource = { path: string; mime: string; reference: AnalyzeImageOutput['source'] };

export function createImageAnalysis({
  clock,
  settings,
  slots,
  opencode,
}: {
  clock: Clock;
  settings: SettingsService;
  slots: ModelSlots;
  opencode: OpencodeClient;
}) {
  let active = 0;
  slots.addCounter(() => active);

  async function analyze(
    source: ImageSource,
    question: string,
    requestSignal?: AbortSignal,
  ): Promise<AnalyzeImageOutput> {
    const configured = settings.get('ai.imageModel');
    if (configured === null) {
      throw new AppError(ErrorCode.ImageAnalysisUnavailable, 'Set the image reader model in Settings first');
    }
    const model = parseModelRef(configured);
    if (!slots.isFree()) {
      throw new AppError(ErrorCode.ModelSlotsFull, 'The image reader needs a free model slot');
    }

    active += 1;
    slots.changed();
    const deadline = new AbortController();
    const cancelTimeout = clock.schedule(IMAGE_ANALYSIS_TIMEOUT_MS, () => deadline.abort());
    const signal = requestSignal === undefined ? deadline.signal : AbortSignal.any([deadline.signal, requestSignal]);
    try {
      const { available } = await opencode.listModels(undefined, signal);
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
      const analysis = await run(question, source.mime, data, model, signal);
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
      active -= 1;
      slots.changed();
    }
  }

  async function run(
    question: string,
    mime: string,
    data: Buffer,
    model: ReturnType<typeof parseModelRef>,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const directory = await mkdtemp(join(tmpdir(), 'aw-image-reader-'));
    try {
      const agent = OPENCODE_IMAGE_AGENT;
      const sessionId = await opencode.createSession({
        directory,
        title: 'Image analysis',
        agent,
        permission: [{ permission: '*', pattern: '*', action: 'deny' }],
        signal,
      });
      try {
        return await opencode.promptImage({ sessionId, directory, model, question, image: { mime, data }, signal });
      } finally {
        // 停止请求也应中止 OpenCode 的生成，再删除含原图的临时会话。
        if (opencode.isConnected()) {
          try {
            if (signal.aborted) await opencode.abort({ sessionId, directory });
          } finally {
            await opencode.deleteSession({ sessionId, directory });
          }
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  return { analyze };
}

export type ImageAnalysis = ReturnType<typeof createImageAnalysis>;
