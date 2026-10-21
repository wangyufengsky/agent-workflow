import { KNOWLEDGE_DOC_DIRS, KNOWLEDGE_DOC_EXTENSIONS } from '../constants/app.ts';
import { KnowledgeSourceKind } from '../enums/knowledge.ts';

/** A citation marker `[n]` in an answer: its number and where it stands in the text. */
export type CitationMarker = { n: number; start: number; end: number };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)[^`][\s\S]*?\1(?!`)|(`+)\2/g;
/** `[12]` that is not the text of a Markdown link `[12](…)`. */
const MARKER = /\[(\d{1,3})\](?!\()/g;

/**
 * The citation markers of an answer (18 §6.1), in order. Code blocks and inline code are skipped: `arr[1]` is code,
 * not a citation. Shared by the backend's validation and the renderer, so both see the same markers.
 */
export function citationMarkers(answer: string): CitationMarker[] {
  const markers: CitationMarker[] = [];
  let fence: string | undefined;
  let offset = 0;
  for (const line of answer.split('\n')) {
    const opening = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      if (opening !== undefined && opening[0] === fence[0] && opening.length >= fence.length) fence = undefined;
    } else if (opening !== undefined) {
      fence = opening;
    } else {
      // Blank out inline code so its brackets are not matched; positions stay the same.
      const masked = line.replace(INLINE_CODE, (code) => ' '.repeat(code.length));
      for (const match of masked.matchAll(MARKER)) {
        markers.push({ n: Number(match[1]), start: offset + match.index, end: offset + match.index + match[0].length });
      }
    }
    offset += line.length + 1;
  }
  return markers;
}

/** Whether a cited repository file is documentation or code (18 §6.1). */
export function classifySource(path: string): typeof KnowledgeSourceKind.Code | typeof KnowledgeSourceKind.Docs {
  const segments = path.toLowerCase().split('/');
  const name = segments.at(-1) ?? '';
  const inDocDir = segments.slice(0, -1).some((s) => KNOWLEDGE_DOC_DIRS.some((d) => d === s));
  const isDocFile = KNOWLEDGE_DOC_EXTENSIONS.some((ext) => name.endsWith(ext));
  return inDocDir || isDocFile ? KnowledgeSourceKind.Docs : KnowledgeSourceKind.Code;
}
