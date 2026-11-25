import {
  functionalTestScopeSchema,
  InboxStatus,
  InputRef,
  MCP_SESSION_ARG,
  type OperationContract,
  scheduleFrequencySchema,
} from '@aw/shared';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { CONFIRMATION_COPY, INPUT_REF_LABEL } from '../../copy/assistant.ts';
import { FUNCTIONAL_TEST_COPY } from '../../copy/functional-testing.ts';
import { INPUT_FIELD_LABEL, INPUT_VALUE_LABEL } from '../../copy/operations.ts';
import { frequencyText } from '../../copy/schedules.ts';
import { INBOX_COPY } from '../../copy/tasks.ts';
import { attachmentQuery } from '../attachments/attachments.api.ts';
import { batchQuery } from '../batches/batches.queries.ts';
import { dbConnectionsQuery } from '../databases/databases.queries.ts';
import { FunctionalTestScopeSummary } from '../functional-testing/functional-test-fields.tsx';
import { inboxQuery } from '../inbox/inbox.queries.ts';
import { initiativeQuery } from '../initiatives/initiatives.queries.ts';
import { knowledgeConversationQuery } from '../knowledge/knowledge.queries.ts';
import { deckQuery } from '../ppt/ppt.queries.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import { scheduleQuery } from '../schedules/schedules.queries.ts';
import { rolesQuery, taskQuery, workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './cards.module.css';

type Input = Record<string, unknown>;

/** A ref field holds one id, or several (a project's database connections). */
const idsSchema = z.union([z.string().transform((id) => [id]), z.array(z.string())]);

/** A scalar in words; objects (a plan, a workflow definition) stay JSON. */
function valueText(field: string, value: unknown): string | undefined {
  if (typeof value === 'boolean') return value ? CONFIRMATION_COPY.yes : CONFIRMATION_COPY.no;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const labels = Object.hasOwn(INPUT_VALUE_LABEL, field) ? INPUT_VALUE_LABEL[field] : undefined;
    return labels && Object.hasOwn(labels, value) ? labels[value] : value;
  }
  // A schedule's frequency in words (22 §2); the model's input is checked like any boundary.
  const frequency = field === 'frequency' ? scheduleFrequencySchema.safeParse(value) : undefined;
  return frequency?.success === true ? frequencyText(frequency.data) : undefined;
}

/** The object's name once known; its id while the query runs or when the object is gone. */
function Named({ ids, names, query }: { ids: string[]; names: (string | undefined)[]; query: UseQueryResult }) {
  if (query.isPending) return <span className={styles.pending}>…</span>;
  return (
    <>
      {ids.map((id, i) => {
        const name = names[i];
        return (
          <span key={id} className={styles.named}>
            {name === undefined ? <span className="mono">{id}</span> : name}
          </span>
        );
      })}
    </>
  );
}

function ListRef<T>({
  ids,
  query,
  find,
}: {
  ids: string[];
  query: UseQueryResult<T[]>;
  find: (items: T[], id: string) => string | undefined;
}) {
  return (
    <Named
      ids={ids}
      names={ids.map((id) => (query.data === undefined ? undefined : find(query.data, id)))}
      query={query}
    />
  );
}

function TaskRef({ id }: { id: string }) {
  const query = useQuery(taskQuery(id));
  return <Named ids={[id]} names={[query.data && `${query.data.key} · ${query.data.title}`]} query={query} />;
}

function NodeRef({ taskId, id }: { taskId: string; id: string }) {
  const query = useQuery(taskQuery(taskId));
  return <Named ids={[id]} names={[query.data?.nodes.find((n) => n.id === id)?.title]} query={query} />;
}

function ProjectRef({ id }: { id: string }) {
  const query = useQuery(projectQuery(id));
  return <Named ids={[id]} names={[query.data?.name]} query={query} />;
}

function BatchRef({ id }: { id: string }) {
  const query = useQuery(batchQuery(id));
  return <Named ids={[id]} names={[query.data && `${query.data.key} · ${query.data.title}`]} query={query} />;
}

function InitiativeRef({ id }: { id: string }) {
  const query = useQuery(initiativeQuery(id));
  return <Named ids={[id]} names={[query.data && `${query.data.key} · ${query.data.title}`]} query={query} />;
}

function ScheduleRef({ id }: { id: string }) {
  const query = useQuery(scheduleQuery(id));
  return <Named ids={[id]} names={[query.data?.title]} query={query} />;
}

function KnowledgeRef({ id }: { id: string }) {
  const query = useQuery(knowledgeConversationQuery(id));
  return <Named ids={[id]} names={[query.data?.title]} query={query} />;
}

function DeckRef({ id }: { id: string }) {
  const query = useQuery(deckQuery(id));
  return <Named ids={[id]} names={[query.data?.title]} query={query} />;
}

function WorkflowRef({ ids }: { ids: string[] }) {
  // Workflows are named by id when used and by key when edited or deleted (EntityKind.Workflow).
  return (
    <ListRef
      ids={ids}
      query={useQuery(workflowsQuery)}
      find={(ws, v) => ws.find((w) => w.id === v || w.key === v)?.name}
    />
  );
}

function RoleRef({ ids }: { ids: string[] }) {
  return <ListRef ids={ids} query={useQuery(rolesQuery)} find={(rs, v) => rs.find((r) => r.id === v)?.name} />;
}

function DbConnectionRef({ ids }: { ids: string[] }) {
  return <ListRef ids={ids} query={useQuery(dbConnectionsQuery)} find={(cs, v) => cs.find((c) => c.id === v)?.name} />;
}

function InboxItemRef({ ids }: { ids: string[] }) {
  const query = useQuery(inboxQuery({ status: InboxStatus.Open }));
  return (
    <ListRef
      ids={ids}
      query={query}
      find={(items, v) => {
        const item = items.find((i) => i.id === v);
        return item && `${INBOX_COPY.kind[item.kind]} · ${item.title}`;
      }}
    />
  );
}

function AttachmentName({ id }: { id: string }) {
  const query = useQuery(attachmentQuery(id));
  return <Named ids={[id]} names={[query.data?.name]} query={query} />;
}

function AttachmentRef({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id) => (
        <AttachmentName key={id} id={id} />
      ))}
    </>
  );
}

function RefValue({ kind, value, input }: { kind: InputRef; value: unknown; input: Input }) {
  const ids = idsSchema.safeParse(value).data;
  if (ids === undefined || ids.length === 0) return <pre className={styles.json}>{JSON.stringify(value, null, 2)}</pre>;
  const [first = ''] = ids;
  switch (kind) {
    case InputRef.Task:
      return <TaskRef id={first} />;
    case InputRef.Node:
      return typeof input.id === 'string' ? (
        <NodeRef taskId={input.id} id={first} />
      ) : (
        <span className="mono">{first}</span>
      );
    case InputRef.Project:
      return <ProjectRef id={first} />;
    case InputRef.KnowledgeConversation:
      return <KnowledgeRef id={first} />;
    case InputRef.Batch:
      return <BatchRef id={first} />;
    case InputRef.Initiative:
      return <InitiativeRef id={first} />;
    case InputRef.Deck:
      return <DeckRef id={first} />;
    case InputRef.Schedule:
      return <ScheduleRef id={first} />;
    case InputRef.Workflow:
      return <WorkflowRef ids={ids} />;
    case InputRef.Role:
      return <RoleRef ids={ids} />;
    case InputRef.DbConnection:
      return <DbConnectionRef ids={ids} />;
    case InputRef.InboxItem:
      return <InboxItemRef ids={ids} />;
    case InputRef.Design:
      return <span className="mono">{first}</span>;
    case InputRef.Attempt:
      return <span className="mono">{first.slice(0, 8)}</span>;
    case InputRef.Attachment:
      return <AttachmentRef ids={ids} />;
  }
}

/**
 * An operation's input in words (15 §4): ids become the objects' names under their kind, fields their labels, enum
 * values their copy. Shared by the confirmation card and the action row of a call that ran without one.
 */
export function InputSummary({ operation, input }: { operation: OperationContract; input: Input }) {
  const fields = Object.entries(input).filter(([field, value]) => value !== undefined && field !== MCP_SESSION_ARG);
  if (fields.length === 0) return null;
  return (
    <dl className={styles.params} aria-label={CONFIRMATION_COPY.input}>
      {fields.map(([field, value]) => {
        // 历史记录也包含模型提交后校验失败的原始参数。
        const scope = field === 'functionalTest' ? functionalTestScopeSchema.safeParse(value).data : undefined;
        if (scope !== undefined) {
          return (
            <div key={field} className={styles.param}>
              <dt>{FUNCTIONAL_TEST_COPY.scope}</dt>
              <dd>
                <FunctionalTestScopeSummary scope={scope} />
                {scope.caseAttachmentIds.length > 0 && (
                  <div className="row wrap">
                    <span>{FUNCTIONAL_TEST_COPY.caseInputs}</span>
                    <AttachmentRef ids={scope.caseAttachmentIds} />
                  </div>
                )}
              </dd>
            </div>
          );
        }
        const ref = operation.refs && Object.hasOwn(operation.refs, field) ? operation.refs[field] : undefined;
        const text = ref === undefined ? valueText(field, value) : undefined;
        return (
          <div key={field} className={styles.param}>
            <dt>
              {ref !== undefined
                ? INPUT_REF_LABEL[ref]
                : Object.hasOwn(INPUT_FIELD_LABEL, field)
                  ? INPUT_FIELD_LABEL[field]
                  : field}
            </dt>
            <dd>
              {ref !== undefined ? (
                <RefValue kind={ref} value={value} input={input} />
              ) : text === undefined ? (
                <pre className={styles.json}>{JSON.stringify(value, null, 2)}</pre>
              ) : (
                text
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
