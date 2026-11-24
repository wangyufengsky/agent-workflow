import { BuiltinRoleKey } from '@aw/builtin';
import { AppError, ErrorCode, type ProcessDocumentInput } from '@aw/shared';
import type { AttachmentsService } from '../attachments/index.ts';
import { type OpencodeClient, parseModelRef, type SessionDispatcher, SessionPurpose } from '../opencode/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';

const DOCUMENT_TIMEOUT_MS = 180_000;
type Dependencies = {
  attachments: AttachmentsService;
  roles: RolesService;
  sessions: SessionDispatcher;
  settings: SettingsService;
  opencode: OpencodeClient;
};

export function createDocumentProcessor({ attachments, roles, sessions, settings, opencode }: Dependencies) {
  async function process(
    input: ProcessDocumentInput,
    checkAttachment: (id: string) => void,
    parentSignal?: AbortSignal,
    delegatedFrom?: AbortSignal,
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
    const role = roles.getByKey(BuiltinRoleKey.DocumentProcessor);
    const model = role.model ?? settings.get('ai.defaultModel');
    const timeout = AbortSignal.timeout(DOCUMENT_TIMEOUT_MS);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
    return sessions.call(
      {
        purpose: SessionPurpose.Document,
        title: 'Document processing',
        ...(delegatedFrom === undefined ? {} : { parentSignal: delegatedFrom }),
        signal,
      },
      async (session) => {
        const text = await opencode.promptDocument({
          ...session,
          system: role.prompt,
          ...(model === null ? {} : { model: parseModelRef(model) }),
          text: JSON.stringify({ instruction: input.instruction, document: content }),
        });
        if (!text.trim())
          throw new AppError(ErrorCode.OpencodeRequestFailed, 'The document processor returned empty text');
        return { text, next_cursor: cursor, next_range: range };
      },
    );
  }
  return { process };
}
export type DocumentProcessor = ReturnType<typeof createDocumentProcessor>;
