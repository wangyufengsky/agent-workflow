import {
  AppError,
  type CitationDTO,
  CitationType,
  type DeckMaterialInput,
  DeckMaterialKind,
  ErrorCode,
  type KnowledgeConversationDTO,
  KnowledgeTurnStatus,
  type TaskDetailDTO,
} from '@aw/shared';

/** Pasted text is listed by its first line. */
const PASTED_TITLE_MAX_CHARS = 40;
const firstLine = (text: string) => (text.trim().split('\n')[0] ?? '').slice(0, PASTED_TITLE_MAX_CHARS);

/** One material as snapshotted into a PPT (23 §7.2): Markdown the AI reads in its first message. */
export type MaterialSnapshot = {
  kind: DeckMaterialKind;
  refId: string | null;
  title: string;
  /** The project the material belongs to, if any: a PPT has at most one. */
  projectId: string | null;
  content: string;
};

export type MaterialSources = {
  task(id: string): TaskDetailDTO;
  knowledge(id: string): KnowledgeConversationDTO;
};

/** The task's result for the AI: requirement, summary, assumptions and the files it changed (not the diff itself). */
function taskSnapshot(task: TaskDetailDTO): string {
  const { result } = task;
  if (result === null) {
    throw new AppError(ErrorCode.ValidationFailed, `Task ${task.key} has no result yet`, {
      issues: [{ path: ['materials'], message: `task ${task.key} has no result yet` }],
    });
  }
  const files = result.files.map((f) => `- ${f.path} (+${f.additions ?? 0} −${f.deletions ?? 0})`);
  return [
    `# Task ${task.key} · ${task.title}`,
    `Project: ${task.project.name} · Workflow: ${task.workflow.name}`,
    '## Requirement',
    task.requirement,
    '## Result summary',
    result.summary,
    '## Assumptions',
    result.assumptions.length === 0 ? 'None.' : result.assumptions.map((a) => `- ${a}`).join('\n'),
    `## Changed files (${result.filesChanged}, +${result.insertions} −${result.deletions})`,
    files.length === 0 ? 'None.' : files.join('\n'),
  ].join('\n\n');
}

/** The answered questions of a knowledge conversation, citations written out with the cited lines. */
function citationLine(c: CitationDTO, i: number): string {
  switch (c.type) {
    case CitationType.File:
      return `[${i + 1}] ${c.path} lines ${c.startLine}–${c.endLine}\n\n\`\`\`\n${c.excerpt}\n\`\`\``;
    case CitationType.Database:
      return `[${i + 1}] database ${c.connection}: ${c.sql}`;
    case CitationType.Web:
      return c.excerpt === null
        ? `[${i + 1}] ${c.title ?? c.url} (${c.url})`
        : `[${i + 1}] ${c.title ?? c.url} (${c.url})\n\n\`\`\`\n${c.excerpt}\n\`\`\``;
  }
}

function knowledgeSnapshot(conversation: KnowledgeConversationDTO): string {
  const turns = conversation.turns.filter((t) => t.status === KnowledgeTurnStatus.Answered && t.answer !== null);
  if (turns.length === 0) {
    throw new AppError(ErrorCode.ValidationFailed, `Knowledge conversation ${conversation.id} has no answer`, {
      issues: [{ path: ['materials'], message: 'the knowledge conversation has no answered question' }],
    });
  }
  const sections = turns.map((turn) => {
    const citations = turn.citations.map(citationLine);
    return [
      `## Q: ${turn.question}`,
      turn.answer,
      ...(citations.length === 0 ? [] : ['Citations:', ...citations]),
    ].join('\n\n');
  });
  return [`# Knowledge Q&A · ${conversation.title}`, `Project: ${conversation.project.name}`, ...sections].join('\n\n');
}

function snapshotOf(input: DeckMaterialInput, sources: MaterialSources): MaterialSnapshot {
  switch (input.kind) {
    case DeckMaterialKind.Text:
      return {
        kind: input.kind,
        refId: null,
        title: firstLine(input.content),
        projectId: null,
        content: input.content,
      };
    case DeckMaterialKind.File:
      return { kind: input.kind, refId: null, title: input.title, projectId: null, content: input.content };
    case DeckMaterialKind.Task: {
      const task = sources.task(input.taskId);
      return {
        kind: input.kind,
        refId: task.id,
        title: `${task.key} · ${task.title}`,
        projectId: task.project.id,
        content: taskSnapshot(task),
      };
    }
    case DeckMaterialKind.Knowledge: {
      const conversation = sources.knowledge(input.conversationId);
      return {
        kind: input.kind,
        refId: conversation.id,
        title: conversation.title,
        projectId: conversation.project.id,
        content: knowledgeSnapshot(conversation),
      };
    }
  }
}

/** Reads the material given to `decks.create` into snapshots; tasks and conversations must exist and have results. */
export function snapshotMaterials(inputs: readonly DeckMaterialInput[], sources: MaterialSources): MaterialSnapshot[] {
  return inputs.map((input) => snapshotOf(input, sources));
}

/** The materials as one block of the first message; each is fenced so the AI tells data from instructions. */
export function describeMaterials(materials: readonly { kind: DeckMaterialKind; title: string; content: string }[]) {
  if (materials.length === 0) return 'None. Work from the brief (and the project code, if there is a project).';
  return materials
    .map((m, i) => `<material index="${i + 1}" kind="${m.kind}" title="${m.title}">\n${m.content}\n</material>`)
    .join('\n\n');
}
