import { InboxStatus, InputRef, MCP_SESSION_ARG, type OperationContract, scheduleFrequencySchema } from '@aw/shared';
import { type UseQueryResult, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { CONFIRMATION_COPY, INPUT_REF_LABEL } from '../../copy/assistant.ts';
import { INPUT_FIELD_LABEL, INPUT_VALUE_LABEL } from '../../copy/operations.ts';
import { frequencyText } from '../../copy/schedules.ts';
import { INBOX_COPY } from '../../copy/tasks.ts';
import { batchQuery } from '../batches/batches.queries.ts';
import { dbConnectionsQuery } from '../databases/databases.queries.ts';
import { inboxQuery } from '../inbox/inbox.queries.ts';
import { knowledgeConversationQuery } from '../knowledge/knowledge.queries.ts';
import { projectQuery } from '../projects/projects.queries.ts';
import { scheduleQuery } from '../schedules/schedules.queries.ts';
import { rolesQuery, taskQuery, workflowsQuery } from '../tasks/tasks.queries.ts';
import styles from './cards.module.css';

type Input = Record<string, unknown>;

/** A ref field holds one id, or several (a project's database connections). */
const idsSchema = z.union([z.string().transform((id) => [id]), z.array(z.string())]);

function fieldLabel(field: string): string {
  const label = INPUT_FIELD_LABEL[field];
  // Confirmed operations' fields are all labelled (copy/operations.test.ts); a gap is a copy defect.
  if (label === undefined) throw new Error(`No label for input field ${field}`);
  return label;
}

/** A scalar in words; objects (a plan, a workflow definition) stay JSON. */
function valueText(field: string, value: unknown): string | undefined {
  if (typeof value === 'boolean') return value ? CONFIRMATION_COPY.yes : CONFIRMATION_COPY.no;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return INPUT_VALUE_LABEL[field]?.[value] ?? value;
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

function ScheduleRef({ id }: { id: string }) {
  const query = useQuery(scheduleQuery(id));
  return <Named ids={[id]} names={[query.data?.title]} query={query} />;
}

function KnowledgeRef({ id }: { id: string }) {
  const query = useQuery(knowledgeConversationQuery(id));
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

function RefValue({ kind, value, input }: { kind: InputRef; value: unknown; input: Input }) {
  const ids = idsSchema.parse(value);
  const [first = ''] = ids;
  switch (kind) {
    case InputRef.Task:
      return <TaskRef id={first} />;
    case InputRef.Node:
      return <NodeRef taskId={z.string().parse(input.id)} id={first} />;
    case InputRef.Project:
      return <ProjectRef id={first} />;
    case InputRef.KnowledgeConversation:
      return <KnowledgeRef id={first} />;
    case InputRef.Batch:
      return <BatchRef id={first} />;
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
    case InputRef.Attempt:
      return <span className="mono">{first.slice(0, 8)}</span>;
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
        const ref = operation.refs?.[field];
        const text = ref === undefined ? valueText(field, value) : undefined;
        return (
          <div key={field} className={styles.param}>
            <dt>{ref === undefined ? fieldLabel(field) : INPUT_REF_LABEL[ref]}</dt>
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
