import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ACTIVE_ATTEMPT_STATUSES,
  AppError,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  DELEGATION_MAX_CHILDREN,
  DELEGATION_PATHS_MAX,
  DELEGATION_READ_MAX_CHARS,
  DELEGATION_SOURCES_MAX,
  DELEGATION_TIMEOUT_MS,
  type DelegateReadonlyOutput,
  ErrorCode,
  GitTreeEntryType,
  type InspectDelegationInput,
  type InspectDelegationOutput,
  SessionAgent,
} from '@aw/shared';
import { readFile, readTree, runGit } from '../git/index.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

type Outcome = DelegateReadonlyOutput['results'][number];
type Sources = Extract<Outcome, { status: 'succeeded' }>['sources'];
type Snapshot = { repo: string; commit: string; sessionDirectory: string; model: string | null };
type Child = Snapshot & {
  ended: PromiseWithResolvers<Pick<AttemptDTO, 'status' | 'error'>>;
  sources: Sources;
  summary: string | null;
};
type Parent = {
  count: number;
  delegating: boolean;
  ended: PromiseWithResolvers<'parent_ended'>;
};

const limitedPaths = (commit: string, paths: string[]): InspectDelegationOutput => ({
  commit,
  paths: paths.slice(0, DELEGATION_PATHS_MAX),
  ...(paths.length > DELEGATION_PATHS_MAX ? { truncated: true } : {}),
});

async function inspect(child: Child, input: InspectDelegationInput): Promise<InspectDelegationOutput> {
  const { commit, repo } = child;
  const { path, startLine, startOffset } = input;
  if (input.action === 'list') {
    const entries = await readTree(repo, commit, path);
    return limitedPaths(
      commit,
      entries.map((entry) => (entry.type === GitTreeEntryType.Tree ? `${entry.path}/` : entry.path)),
    );
  }
  if (input.action === 'search') {
    if (input.query === undefined) throw new Error('Validated delegation search has no query');
    const args = ['grep', '-I', '-F', '-l', '-z', '-e', input.query, commit, '--'];
    if (path !== '') args.push(`:(literal)${path}`);
    const { stdout } = await runGit(args, { cwd: repo, okExitCodes: [0, 1] });
    return limitedPaths(
      commit,
      stdout
        .split('\0')
        .filter(Boolean)
        .map((entry) => entry.slice(commit.length + 1)),
    );
  }
  const file = await readFile(repo, commit, path);
  if (!('content' in file)) return { commit, unavailable: 'binary' in file ? 'binary' : 'too_large' };
  const lines = file.content.split('\n');
  const [first = '', ...after] = lines.slice(startLine - 1);
  if (startOffset > first.length)
    throw new AppError(ErrorCode.ValidationFailed, 'startOffset is outside the line', {
      issues: [{ path: ['startOffset'], message: 'Use the nextOffset from the preceding read' }],
    });
  const remaining = [first.slice(startOffset), ...after].join('\n');
  const clipped = remaining.slice(0, DELEGATION_READ_MAX_CHARS);
  const truncated = clipped.length < remaining.length;
  const boundary = truncated ? clipped.lastIndexOf('\n') + 1 : 0;
  const lastCode = clipped.charCodeAt(clipped.length - 1);
  // 优先在完整行后分页。单行超长时保留行内游标，且分页不拆成对的 UTF-16 字符。
  const end = boundary || (truncated && lastCode >= 0xd800 && lastCode <= 0xdbff ? clipped.length - 1 : clipped.length);
  const text = clipped.slice(0, end);
  const endLine = startLine + text.split('\n').length - 1;
  if (
    text !== '' &&
    child.sources.length < DELEGATION_SOURCES_MAX &&
    !child.sources.some((source) => source.path === path && source.startLine === startLine)
  ) {
    child.sources.push({ path, startLine, endLine });
  }
  return {
    commit,
    text,
    startLine,
    ...(truncated
      ? { truncated: true, nextLine: endLine, nextOffset: endLine === startLine ? startOffset + text.length : 0 }
      : {}),
  };
}

/** 节点发起的只读委派使用正常尝试生命周期，且每次只读父节点选定的 Git 快照。 */
export function createTaskDelegation({ attempts, clock, opencode, projects }: TasksServiceDeps, state: TaskState) {
  const parents = new Map<string, Parent>();
  const children = new Map<string, Child>();

  attempts.onSignal(({ type, attempt }) => {
    if (type !== 'ended') return;
    const child = children.get(attempt.id);
    if (child !== undefined) child.ended.resolve(attempt);
    const parent = parents.get(attempt.id);
    if (parent === undefined) return;
    parent.ended.resolve('parent_ended');
    parents.delete(attempt.id);
  });

  function childOf(attempt: AttemptDTO): Child {
    const child = children.get(attempt.id);
    if (child === undefined) throw new AppError(ErrorCode.McpAttemptUnresolved, 'Delegation is no longer active');
    return child;
  }

  async function run(
    parentAttempt: AttemptDTO,
    task: { id: string; projectId: string; key: string },
    parent: Parent,
    snapshot: Snapshot,
    question: string,
  ): Promise<Outcome> {
    if (!attempts.canStartDelegation()) return { question, status: 'unavailable', reason: 'model_slots_busy' };
    const id = randomUUID();
    const child: Child = {
      ...snapshot,
      ended: Promise.withResolvers<Pick<AttemptDTO, 'status' | 'error'>>(),
      sources: [],
      summary: null,
    };
    children.set(id, child);
    parent.count += 1;
    const timeout = Promise.withResolvers<'timeout'>();
    const cancelTimeout = clock.schedule(DELEGATION_TIMEOUT_MS, () => timeout.resolve('timeout'));
    try {
      const launch = attempts.start({
        id,
        kind: AttemptKind.Delegation,
        taskId: task.id,
        nodeId: parentAttempt.nodeId,
        projectId: task.projectId,
        roleId: null,
        agent: SessionAgent.Delegate,
        directory: snapshot.sessionDirectory,
        title: `${task.key} · read-only delegation`,
        model: snapshot.model,
        delegation: { parentAttemptId: parentAttempt.id, commit: snapshot.commit },
        prompt: `Committed snapshot: ${snapshot.commit}\n\nQuestion from the parent step:\n${question}`,
      });
      const result = await Promise.race([
        launch.then(() => child.ended.promise),
        timeout.promise,
        parent.ended.promise,
      ]);
      if (typeof result === 'string') {
        if (ACTIVE_ATTEMPT_STATUSES.includes(attempts.get(id).status)) await attempts.abort(id);
        return { question, attemptId: id, status: 'failed', reason: result };
      }
      if (result.status !== AttemptStatus.Succeeded || child.summary === null) {
        return { question, attemptId: id, status: 'failed', reason: result.error?.code ?? result.status };
      }
      return { question, attemptId: id, status: 'succeeded', summary: child.summary, sources: child.sources };
    } finally {
      cancelTimeout();
      children.delete(id);
    }
  }

  return {
    async delegateReadonly(attempt: AttemptDTO, questions: readonly string[]): Promise<DelegateReadonlyOutput> {
      if (attempt.taskId === null || attempt.nodeId === null)
        throw new AppError(ErrorCode.McpToolNotAllowed, 'Read-only delegation is available only in a workflow step');
      const task = state.get(attempt.taskId);
      const parent = parents.get(attempt.id) ?? {
        count: 0,
        delegating: false,
        ended: Promise.withResolvers<'parent_ended'>(),
      };
      if (parent.delegating || parent.count + questions.length > DELEGATION_MAX_CHILDREN)
        throw new AppError(ErrorCode.ValidationFailed, 'Delegation budget already in use or exceeded', {
          issues: [{ path: ['questions'], message: 'A step attempt can start up to two read-only delegates' }],
        });
      parent.delegating = true;
      parents.set(attempt.id, parent);
      try {
        const { directory } = state.runContext(task);
        const { stdout: commit } = await runGit(['rev-parse', 'HEAD'], { cwd: directory });
        // 会话从空目录启动，项目仓库的本地指令与工具配置不会由运行时加载。
        const sessionDirectory = await mkdtemp(join(await realpath(tmpdir()), 'aw-delegate-'));
        try {
          const model = await opencode.prepareDelegationModel({
            sourceDirectory: directory,
            sourceSessionId: attempt.opencodeSessionId,
            targetDirectory: sessionDirectory,
            model: attempt.model,
          });
          if (!parents.has(attempt.id))
            throw new AppError(ErrorCode.McpAttemptUnresolved, 'Parent attempt ended before delegation');
          const repo = projects.getRecord(task.projectId).repoPath;
          const settled = await Promise.allSettled(
            questions.map((question) =>
              run(attempt, task, parent, { repo, commit, sessionDirectory, model }, question),
            ),
          );
          return {
            commit,
            results: settled.map((outcome) => {
              if (outcome.status === 'rejected') throw outcome.reason;
              return outcome.value;
            }),
          };
        } finally {
          await rm(sessionDirectory, { recursive: true, force: true });
        }
      } finally {
        parent.delegating = false;
      }
    },
    inspectDelegation: (attempt: AttemptDTO, input: InspectDelegationInput) => inspect(childOf(attempt), input),
    submitDelegation(attempt: AttemptDTO, summary: string): void {
      const child = childOf(attempt);
      child.summary = summary;
      attempts.markSubmitted(attempt.id);
    },
  };
}
