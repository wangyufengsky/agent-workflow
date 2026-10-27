import { PromptName, type Prompts, renderTemplate } from '@aw/builtin';
import {
  askKnowledgeOp,
  type CitationDTO,
  CitationType,
  followUpKnowledgeOp,
  type KnowledgeConversationDTO,
  KnowledgeTurnStatus,
  knowledgeLink,
} from '@aw/shared';
import type { Logger } from '../../core/logger.ts';
import type { KnowledgeService, TurnEnded } from '../knowledge/index.ts';
import type { AssistantService } from './assistant.service.ts';

/** What the model is told when its question went to the researcher (18 §4a). */
export const RESEARCHING_INSTRUCTION =
  'The knowledge researcher is looking this up, which can take a few minutes. Tell the user in one sentence that you ' +
  'are researching it and end your turn now; the answer with its citations will be sent to you as the next message.';

/** The operations whose result the assistant hears about later (18 §4a). */
export const KNOWLEDGE_QUESTION_OPS = [askKnowledgeOp.id, followUpKnowledgeOp.id] as const;

function describeCitation(citation: CitationDTO): string {
  switch (citation.type) {
    case CitationType.File:
      return citation.startLine === citation.endLine
        ? `${citation.path} line ${citation.startLine}`
        : `${citation.path} lines ${citation.startLine}-${citation.endLine}`;
    case CitationType.Database:
      return `database ${citation.connection}: ${citation.sql}`;
    case CitationType.Web:
      return `${citation.title ?? 'web page'}: ${citation.url}`;
  }
}

/**
 * Questions the assistant asks the knowledge researcher (18 §4a): the tool answers at once with `researching` (the
 * navigation card to the knowledge conversation is already in the assistant conversation), and when the turn ends its
 * answer (or why there is none) goes to the asking conversation as the next message. Who waits for which turn is kept in memory: a restart interrupts the
 * research itself (03 §2.1), and the knowledge page still shows the outcome.
 */
export function createKnowledgeRelay(deps: {
  knowledge: KnowledgeService;
  conversations: AssistantService;
  prompts: Prompts;
  log: Logger;
}) {
  const { knowledge, conversations, prompts, log } = deps;
  /** Assistant conversation id by knowledge turn id. */
  const waiting = new Map<string, string>();

  function message(conversation: KnowledgeConversationDTO, turnId: string): string {
    const turn = conversation.turns.find((t) => t.id === turnId);
    // The turn ended a moment ago and turns are only deleted with their idle conversation.
    if (turn === undefined) throw new Error(`Knowledge turn ${turnId} not found`);
    const pageLink = knowledgeLink(conversation.id);
    if (turn.status === KnowledgeTurnStatus.Answered && turn.answer !== null) {
      const links = turn.citations.map((_, i) => knowledgeLink(conversation.id, { turnId, index: i + 1 }));
      return renderTemplate(prompts[PromptName.AssistantKnowledgeAnswered], {
        conversationId: conversation.id,
        question: turn.question,
        answer: turn.answer,
        citations:
          turn.citations.length === 0
            ? 'None.'
            : turn.citations.map((c, i) => `[${i + 1}] ${describeCitation(c)} — link: ${links[i]}`).join('\n'),
        pageLink,
        exampleLink: links[0] ?? pageLink,
      });
    }
    return renderTemplate(prompts[PromptName.AssistantKnowledgeFailed], {
      conversationId: conversation.id,
      question: turn.question,
      status: turn.status,
      error: turn.attempt.error === null ? 'None.' : `${turn.attempt.error.code}: ${turn.attempt.error.message}`,
      pageLink,
    });
  }

  async function relay({ conversationId, turnId }: TurnEnded): Promise<void> {
    const assistantId = waiting.get(turnId);
    if (assistantId === undefined) return;
    waiting.delete(turnId);
    await conversations.deliver(assistantId, message(knowledge.get(conversationId), turnId));
  }

  // Nobody awaits the relay: a failure is logged (the knowledge page still shows the outcome).
  const relayLater = (ended: TurnEnded) => {
    relay(ended).catch((err: unknown) => log.error({ err, ...ended }, 'knowledge answer not relayed to the assistant'));
  };
  knowledge.onTurnEnded(relayLater);

  return {
    /** The tool result of a question the assistant asked: its latest turn is now awaited. */
    researching(assistantConversationId: string, output: unknown) {
      const conversation = askKnowledgeOp.output.parse(output);
      const turn = conversation.turns.at(-1);
      // ask and followUp return the conversation with the turn they started.
      if (turn === undefined) throw new Error(`Knowledge conversation ${conversation.id} has no turn`);
      waiting.set(turn.id, assistantConversationId);
      // The turn may have ended while the operation returned; the message then waits for the assistant's turn to end.
      const now = knowledge.get(conversation.id).turns.find((t) => t.id === turn.id);
      if (now !== undefined && now.status !== KnowledgeTurnStatus.Researching) {
        relayLater({ conversationId: conversation.id, turnId: turn.id });
      }
      return {
        status: 'researching',
        knowledge_conversation_id: conversation.id,
        instruction: RESEARCHING_INSTRUCTION,
      };
    },
  };
}
