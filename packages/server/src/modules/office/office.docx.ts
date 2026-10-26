import { AttachmentFormat, type OfficeMeta } from '@aw/shared';
import mammoth from 'mammoth';
import { htmlToMarkdown } from './office.markdown.ts';

/**
 * A Word body as Markdown (39 §5.2). Pictures become numbered placeholders (the model reads text only); mammoth
 * leaves links to files outside the document unread (`externalFileAccess` is off by default since 1.11).
 */
export async function readDocx(bytes: Buffer): Promise<{ text: string; meta: OfficeMeta }> {
  const { value: html } = await mammoth.convertToHtml(
    { buffer: bytes },
    { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) },
  );
  const { markdown, counts } = htmlToMarkdown(html);
  return { text: `${markdown}\n`, meta: { format: AttachmentFormat.Docx, chars: markdown.length, ...counts } };
}
