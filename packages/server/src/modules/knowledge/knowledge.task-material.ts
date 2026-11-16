import { type CitationDTO, CitationType, citationMarkers } from '@aw/shared';

const CITATION_EXCERPT_CHARS = 800;

export function selectedAnswer(answer: string, from: number, to: number, citations: ReadonlySet<number>): string {
  let text = answer.slice(from, to);
  for (const marker of citationMarkers(answer).reverse()) {
    if (marker.end <= from || marker.start >= to) continue;
    if (citations.has(marker.n) && marker.start >= from && marker.end <= to) continue;
    text = text.slice(0, Math.max(0, marker.start - from)) + text.slice(Math.min(to, marker.end) - from);
  }
  return text.trim();
}

function citationText(citation: CitationDTO): string {
  switch (citation.type) {
    case CitationType.File:
      return `${citation.path}:${citation.startLine}-${citation.endLine}\n${citation.excerpt.slice(0, CITATION_EXCERPT_CHARS)}`;
    case CitationType.Web:
      return [citation.title, citation.url, citation.excerpt?.slice(0, CITATION_EXCERPT_CHARS)]
        .filter(Boolean)
        .join('\n');
    case CitationType.Database:
      // 保留查询来源。生成素材时不重新执行查询，也不把实时结果当成回答时的证据。
      return `数据库：${citation.connection}\n查询：${citation.sql}`;
  }
}

export function knowledgeTaskMaterialText(input: {
  conversationId: string;
  turnId: string;
  question: string;
  answeredAt: number;
  excerpt: string;
  citations: readonly { index: number; citation: CitationDTO }[];
}): string {
  return [
    '知识问答资料快照。以下内容来自过去的回答，请核对当前情况。',
    `来源问答：${input.conversationId}\n回答轮次：${input.turnId}\n回答时间：${new Date(input.answeredAt).toISOString()}`,
    `问题：${input.question}`,
    `所选结论\n${input.excerpt}`,
    ...input.citations.map(({ index, citation }) => `[${index}] ${citationText(citation)}`),
  ].join('\n\n');
}
