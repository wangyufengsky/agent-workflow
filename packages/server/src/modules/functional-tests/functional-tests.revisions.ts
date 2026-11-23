import { isDeepStrictEqual } from 'node:util';
import {
  AppError,
  type AttemptDTO,
  ErrorCode,
  FUNCTIONAL_TEST_NODE,
  type FunctionalTestCase,
  type FunctionalTestScope,
  type FunctionalTestSnapshot,
  FunctionalTestStatus,
  functionalTestCaseSchema,
  type functionalTestReviseSchema,
  type TaskDetailDTO,
} from '@aw/shared';
import { z } from 'zod';
import { runGit } from '../git/index.ts';
import { fieldValue, redactText } from './functional-tests.http.ts';
import type { FunctionalTestRepo } from './functional-tests.repo.ts';
import { latestCases } from './functional-tests.reports.ts';

type Context = { record: TaskDetailDTO; scope: FunctionalTestScope };
type Input = z.output<typeof functionalTestReviseSchema>;
type Definition = Omit<FunctionalTestCase, 'id' | 'number' | 'version'>;

function definitionOf(input: Input, before: FunctionalTestCase): Definition {
  if (input.definition !== undefined && input.change === undefined) return input.definition;
  const change = input.change;
  if (change === undefined || input.definition !== undefined)
    throw new AppError(ErrorCode.ValidationFailed, 'Supply exactly one of definition or change');
  const { id, number, version, ...old } = before;
  const step = old.steps[change.step];
  if (step?.kind !== 'http')
    throw new AppError(ErrorCode.ValidationFailed, 'Select an HTTP step in the saved definition');
  let updated = step;
  if (change.kind === 'rename_request_field') {
    const body = step.body;
    if (
      body === undefined ||
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !Object.hasOwn(body, change.from) ||
      Object.hasOwn(body, change.to)
    )
      throw new AppError(
        ErrorCode.ValidationFailed,
        'The original field must exist and the replacement must be unused',
      );
    updated = {
      ...step,
      body: Object.fromEntries(
        Object.entries(body).map(([key, value]) => [key === change.from ? change.to : key, value]),
      ),
    };
  } else {
    const status = step.assertions.filter(({ field }) => field === 'status');
    if (status.length !== 1)
      throw new AppError(ErrorCode.ValidationFailed, 'The selected step must have exactly one status assertion');
    updated = {
      ...step,
      assertions: step.assertions.map((assertion) =>
        assertion.field === 'status' ? { ...assertion, equals: change.expected } : assertion,
      ),
    };
  }
  return { ...old, steps: old.steps.map((item, index) => (index === change.step ? updated : item)) };
}

const contractPath = /^(?!\/|.*(?:^|\/)\.\.(?:\/|$))[\w./-]+\.json$/;
const contractSchema = z.object({ openapi: z.string().startsWith('3.'), paths: z.record(z.string(), z.json()) });

/** 只有被测提交上的合同能自动纠正唯一的成功状态码或明确的请求字段。 */
async function contractProves(
  path: string | undefined,
  next: Definition,
  before: FunctionalTestCase,
  record: TaskDetailDTO,
): Promise<boolean> {
  if (
    path === undefined ||
    !contractPath.test(path) ||
    record.git.worktreePath === null ||
    record.git.baseCommit === null
  )
    return false;
  // 只读固定提交的内容，避免引用执行期间临时写入的文件。
  let content: string;
  try {
    content = (await runGit(['show', `${record.git.baseCommit}:${path}`], { cwd: record.git.worktreePath })).stdout;
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCode.GitCommandFailed) return false;
    throw error;
  }
  const raw = z.string().max(1_000_000).safeParse(content);
  if (!raw.success) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.data);
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  const contract = contractSchema.safeParse(parsed);
  if (!contract.success) return false;
  const { id, number, version, ...old } = before;
  if (!isDeepStrictEqual({ ...next, steps: [] }, { ...old, steps: [] }) || next.steps.length !== old.steps.length)
    return false;
  let changes = 0;
  for (const [index, step] of next.steps.entries()) {
    const original = old.steps[index];
    if (isDeepStrictEqual(step, original)) continue;
    if (
      step.kind !== 'http' ||
      original?.kind !== 'http' ||
      step.method !== original.method ||
      step.path !== original.path
    )
      return false;
    if (
      !isDeepStrictEqual({ ...step, body: undefined, assertions: [] }, { ...original, body: undefined, assertions: [] })
    )
      return false;
    const operation = fieldValue(contract.data.paths[step.path], step.method.toLowerCase());
    if (operation === undefined) return false;
    if (step.assertions.length !== original.assertions.length) return false;
    const responses = fieldValue(operation, 'responses');
    const success =
      responses !== undefined && responses !== null && typeof responses === 'object'
        ? Object.keys(responses).filter((key) => /^2\d\d$/.test(key))
        : [];
    for (const [assertionIndex, assertion] of step.assertions.entries()) {
      const previous = original.assertions[assertionIndex];
      if (isDeepStrictEqual(assertion, previous)) continue;
      if (
        assertion.field !== 'status' ||
        previous?.field !== 'status' ||
        success.length !== 1 ||
        typeof previous.equals !== 'number' ||
        previous.equals < 200 ||
        previous.equals >= 300 ||
        assertion.equals !== Number(success[0]) ||
        !isDeepStrictEqual(assertion, { ...previous, equals: assertion.equals })
      )
        return false;
      changes++;
    }
    if (!isDeepStrictEqual(step.body, original.body)) {
      const media = fieldValue(operation, 'requestBody.content');
      const props =
        media !== null && typeof media === 'object'
          ? fieldValue(Reflect.get(media, 'application/json'), 'schema.properties')
          : undefined;
      if (
        props === undefined ||
        props === null ||
        typeof props !== 'object' ||
        step.body === undefined ||
        step.body === null ||
        typeof step.body !== 'object' ||
        Array.isArray(step.body) ||
        original.body === undefined ||
        original.body === null ||
        typeof original.body !== 'object' ||
        Array.isArray(original.body)
      )
        return false;
      const oldBody = original.body;
      const newBody = step.body;
      const added = Object.keys(newBody).filter((key) => !Object.hasOwn(oldBody, key));
      const removed = Object.keys(oldBody).filter((key) => !Object.hasOwn(newBody, key));
      const add = added[0];
      const remove = removed[0];
      if (
        added.length !== 1 ||
        removed.length !== 1 ||
        add === undefined ||
        remove === undefined ||
        !Object.hasOwn(props, add) ||
        Object.hasOwn(props, remove) ||
        !isDeepStrictEqual(
          Object.fromEntries(Object.entries(original.body).map(([key, value]) => [key === remove ? add : key, value])),
          step.body,
        )
      )
        return false;
      changes++;
    }
  }
  return changes > 0;
}

export function functionalTestRevisions({
  repo,
  resolve,
  context,
}: {
  repo: FunctionalTestRepo;
  resolve: (
    attempt: AttemptDTO,
    phases: readonly (typeof FUNCTIONAL_TEST_NODE.Execute)[],
  ) => Context & { taskId: string };
  context: (taskId: string) => Context;
}) {
  function latest(snapshot: FunctionalTestSnapshot, caseId: string, version: number) {
    const test = latestCases(snapshot).find(({ id }) => id === caseId);
    if (test?.version !== version)
      throw new AppError(ErrorCode.ValidationFailed, 'The case version changed; read the latest case first');
    return test;
  }

  return {
    async revise(attempt: AttemptDTO, input: Input) {
      const { taskId, record } = resolve(attempt, [FUNCTIONAL_TEST_NODE.Execute]);
      const { caseId, version, executionId } = input;
      const snapshot = repo.get(taskId);
      const before = latest(snapshot, caseId, version);
      const execution = snapshot.executions.find(({ id }) => id === executionId);
      if (
        execution?.caseId !== caseId ||
        execution.version !== version ||
        execution.status === FunctionalTestStatus.Running
      )
        throw new AppError(ErrorCode.ValidationFailed, 'The triggering execution does not belong to this case version');
      const definition = definitionOf(input, before);
      if (definition.steps.length === 0 && definition.needsClarification === undefined)
        throw new AppError(ErrorCode.ValidationFailed, 'Supply executable steps or mark the missing expectation');
      if (!isDeepStrictEqual(before.source, definition.source))
        throw new AppError(ErrorCode.ValidationFailed, 'Keep the original case source reference');
      const candidate = { ...definition, id: caseId, version: version + 1, number: before.number };
      const environment = snapshot.runs.find(({ id }) => id === execution.runId)?.environment;
      const verified =
        environment?.verified === true &&
        environment.baseline === record.git.baseCommit &&
        (await contractProves(input.contractPath, definition, before, record));
      return repo.update(taskId, (current) => {
        latest(current, caseId, version);
        const detail = {
          from: version,
          to: candidate.version,
          reason: redactText(input.reason),
          basis: redactText(input.basis),
          author: attempt.id,
          before: JSON.parse(JSON.stringify(before)),
          after: JSON.parse(JSON.stringify(candidate)),
          pending: !verified,
          ...(input.contractPath === undefined ? {} : { contractPath: input.contractPath }),
        };
        if (
          current.events.some(
            (event) =>
              event.kind === 'revision' &&
              event.caseId === caseId &&
              event.detail.basis === detail.basis &&
              event.detail.pending === false &&
              event.detail.author === attempt.id,
          )
        )
          throw new AppError(
            ErrorCode.ValidationFailed,
            'The same basis already revised this case; obtain new evidence',
          );
        if (verified) current.cases.push(candidate);
        repo.event(current, {
          caseId,
          executionId,
          runId: execution.runId,
          kind: 'revision',
          message: verified ? '已按被测版本的接口契约修订用例' : '用例修订需要用户确认',
          detail,
        });
        return {
          case: verified ? candidate : before,
          pending: !verified,
          ...(verified
            ? {}
            : {
                proposal: current.nextAfter,
                reason:
                  'The supplied correction is not uniquely proven by the contract at the verified baseline. The current version is unchanged until the user approves this proposal.',
              }),
        };
      });
    },
    approveRevision(taskId: string, proposal: number) {
      context(taskId);
      return repo.update(taskId, (snapshot) => {
        const event = snapshot.events.find(({ seq, kind }) => seq === proposal && kind === 'revision');
        if (event?.detail.pending !== true || event.caseId === null || typeof event.detail.from !== 'number')
          throw new AppError(ErrorCode.NotFound, 'Pending revision not found');
        const after = functionalTestCaseSchema.parse(event.detail.after);
        if (snapshot.reports.some(({ runId }) => runId === event.runId))
          throw new AppError(ErrorCode.StateTransitionInvalid, 'The run has already published a report');
        latest(snapshot, event.caseId, event.detail.from);
        snapshot.cases.push(after);
        const { caseId, executionId, runId } = event;
        repo.event(snapshot, {
          caseId,
          executionId,
          runId,
          kind: 'revision',
          message: '用户已确认用例修订',
          detail: { ...event.detail, pending: false, author: 'user', proposal },
        });
        return after;
      });
    },
  };
}
