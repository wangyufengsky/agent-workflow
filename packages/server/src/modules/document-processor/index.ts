import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuiltinRoleKey } from '@aw/builtin';
import { AppError, ErrorCode, OPENCODE_DOCUMENT_AGENT, type ProcessDocumentInput } from '@aw/shared';
import type { AttachmentsService } from '../attachments/index.ts';
import type { ModelSlots } from '../model-slots/index.ts';
import { type OpencodeClient, parseModelRef } from '../opencode/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';

const DOCUMENT_TIMEOUT_MS = 180_000;
type Dependencies = {
  attachments: AttachmentsService;
  roles: RolesService;
  slots: ModelSlots;
  settings: SettingsService;
  opencode: OpencodeClient;
};

export function createDocumentProcessor({ attachments, roles, slots, settings, opencode }: Dependencies) {
  let active = 0;
  slots.addCounter(() => active);

  async function process(
    input: ProcessDocumentInput,
    checkAttachment: (id: string) => void,
    parentSignal?: AbortSignal,
  ) {
    let content = '';
    let cursor: number | null = null;
    let range: string | null = null;
    const source = input.source;
    if (source && 'attachment_id' in source) {
      checkAttachment(source.attachment_id);
      if ('sheet' in source) {
        const page = await attachments.readSheet({ ...source, include_formulas: false });
        content = JSON.stringify(page);
        range = page.next_range;
      } else {
        const page = attachments.read(source.attachment_id, source.cursor ?? 0);
        content = page.text;
        cursor = page.next_cursor;
      }
    } else if (source) {
      content = source.excerpt;
    }
    if (!slots.isFree()) throw new AppError(ErrorCode.ModelSlotsFull, 'Document processing needs a model slot');
    const role = roles.getByKey(BuiltinRoleKey.DocumentProcessor);
    const model = role.model ?? settings.get('ai.defaultModel');
    const timeout = AbortSignal.timeout(DOCUMENT_TIMEOUT_MS);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
    active++;
    slots.changed();
    try {
      const directory = await mkdtemp(join(tmpdir(), 'aw-document-'));
      try {
        const sessionId = await opencode.createSession({
          agent: OPENCODE_DOCUMENT_AGENT,
          title: 'Document processing',
          directory,
          permission: [{ permission: '*', pattern: '*', action: 'deny' }],
          signal,
        });
        try {
          const text = await opencode.promptDocument({
            sessionId,
            directory,
            signal,
            system: role.prompt,
            ...(model === null ? {} : { model: parseModelRef(model) }),
            text: JSON.stringify({ instruction: input.instruction, document: content }),
          });
          if (!text.trim())
            throw new AppError(ErrorCode.OpencodeRequestFailed, 'The document processor returned empty text');
          return { text, next_cursor: cursor, next_range: range };
        } finally {
          if (opencode.isConnected())
            await opencode.deleteSession({ sessionId, directory, signal: AbortSignal.timeout(5000) });
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    } finally {
      active--;
      slots.changed();
    }
  }
  return { process };
}
export type DocumentProcessor = ReturnType<typeof createDocumentProcessor>;
