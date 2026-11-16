import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  AppError,
  ARTIFACT_PREVIEW_CHARS,
  type ArtifactVersion,
  ATTACHMENT_READ_MAX_CHARS,
  type AttemptDTO,
  AttemptKind,
  AttemptStatus,
  artifactNameSchema,
  artifactRoundSchema,
  artifactVersionSchema,
  ErrorCode,
  isArtifactWorkflow,
  OFFICE_ATTACHMENT_BYTES_MAX,
  type OfficeFileWritten,
  type OfficeSource,
  type ReadOfficeFileInput,
  TaskEventEntity,
  TaskStatus,
} from '@aw/shared';
import { listTaskEvents, recordTaskEvent } from '../timeline/index.ts';
import type { TaskState, TasksServiceDeps } from './tasks.state.ts';

const VERSION_EVENT = 'artifact_version';
export const ARTIFACT_ROUND_EVENT = 'artifact_round';
export const ARTIFACT_REVISION_PREFIX = 'artifact_revision_';
export const ARTIFACT_FIRST_NODE = 'write_artifact';

/** 产物原件和每版快照放在任务目录，验收清理工作树后仍可查看与下载。 */
export function createTaskArtifacts(deps: TasksServiceDeps, state: TaskState) {
  function permitted(attempt: AttemptDTO) {
    if (attempt.taskId === null || attempt.nodeId === null || attempt.kind !== AttemptKind.Execute)
      throw new AppError(ErrorCode.McpToolNotAllowed, 'This tool needs a document task step');
    const task = state.get(attempt.taskId);
    if (!isArtifactWorkflow(deps.workflows.get(task.workflowId)))
      throw new AppError(ErrorCode.McpToolNotAllowed, 'This tool is only available in a document task');
    return { task, nodeId: attempt.nodeId };
  }

  const allVersions = (id: string) =>
    listTaskEvents(deps.db, id, 0, VERSION_EVENT).map(({ payload }) => artifactVersionSchema.parse(payload));

  function visibleVersions(id: string): ArtifactVersion[] {
    const versions = allVersions(id);
    const attempts = deps.attempts.summaries(versions.map((version) => version.attemptId));
    const ready = versions.filter((version) => attempts.get(version.attemptId)?.status === AttemptStatus.Succeeded);
    if (ready.length > 0) return ready;
    return versions.filter((version) => {
      const status = attempts.get(version.attemptId)?.status;
      return status === AttemptStatus.Running || status === AttemptStatus.Starting;
    });
  }

  const original = (taskId: string, version: Pick<ArtifactVersion, 'id' | 'name'>) =>
    join(deps.dataDir, 'runs', taskId, 'artifacts', version.id, version.name);

  function versionOf(taskId: string, id: string) {
    state.get(taskId);
    const version = visibleVersions(taskId).find((entry) => entry.id === id);
    if (version === undefined) throw new AppError(ErrorCode.NotFound, 'Artifact version not found', { id });
    return version;
  }

  function latestFor(attempt: AttemptDTO): ArtifactVersion | undefined {
    const { task } = permitted(attempt);
    return (
      allVersions(task.id).findLast((version) => version.attemptId === attempt.id) ?? visibleVersions(task.id).at(-1)
    );
  }

  function source(attempt: AttemptDTO, value: OfficeSource): string {
    const { task } = permitted(attempt);
    if ('attachment_id' in value) {
      if (!state.attachmentsOf(task).some((attachment) => attachment.id === value.attachment_id))
        throw new AppError(ErrorCode.AttachmentNotFound, 'The attachment is not part of this task');
      return deps.attachments.originalPath(value.attachment_id);
    }
    const version = latestFor(attempt);
    if (version === undefined || version.name !== value.file)
      throw new AppError(ErrorCode.NotFound, 'The source file must be the current task artifact');
    return original(task.id, version);
  }

  async function write(
    attempt: AttemptDTO,
    name: string,
    writer: (path: string) => Promise<OfficeFileWritten['lost']>,
  ): Promise<ArtifactVersion> {
    const { task, nodeId } = permitted(attempt);
    assertWriting(task.id, attempt.id, nodeId);
    const checked = artifactNameSchema.safeParse(name);
    if (!checked.success) throw new AppError(ErrorCode.ValidationFailed, 'Use a simple artifact file name');
    const nameOfFile = checked.data;
    const id = randomUUID();
    const directory = join(deps.dataDir, 'runs', task.id, 'artifacts', id);
    const file = original(task.id, { id, name: nameOfFile });
    await mkdir(directory, { recursive: true });
    let result: ArtifactVersion;
    try {
      const lost = await writer(file);
      const { size } = await stat(file);
      if (size > OFFICE_ATTACHMENT_BYTES_MAX)
        throw new AppError(ErrorCode.AttachmentTooLarge, 'The artifact exceeds the file size limit');
      result = deps.unit.transact(() => {
        assertWriting(task.id, attempt.id, nodeId);
        const previous = latestFor(attempt);
        if (previous !== undefined && previous.name !== nameOfFile) {
          throw new AppError(ErrorCode.ValidationFailed, `Keep the current artifact name: ${previous.name}`);
        }
        const version = {
          id,
          number: (allVersions(task.id).at(-1)?.number ?? 0) + 1,
          name: nameOfFile,
          size,
          nodeId,
          attemptId: attempt.id,
          createdAt: deps.clock.now(),
          lost,
        };
        recordTaskEvent(deps.db, {
          taskId: task.id,
          entity: TaskEventEntity.Node,
          entityId: nodeId,
          type: VERSION_EVENT,
          payload: version,
          createdAt: version.createdAt,
        });
        return version;
      });
    } catch (error) {
      await rm(directory, { force: true, recursive: true });
      throw error;
    }
    state.publish(task.id);
    return result;
  }

  function assertWriting(taskId: string, attemptId: string, nodeId: string) {
    const attempt = deps.attempts.get(attemptId);
    const key = deps.nodes.get(nodeId).key;
    if (key !== ARTIFACT_FIRST_NODE && !key.startsWith(ARTIFACT_REVISION_PREFIX))
      throw new AppError(ErrorCode.McpToolNotAllowed, 'Only artifact creation and revision steps publish versions');
    if (
      state.get(taskId).status !== TaskStatus.Running ||
      (attempt.status !== AttemptStatus.Running && attempt.status !== AttemptStatus.Starting)
    )
      throw new AppError(ErrorCode.McpAttemptUnresolved, 'The artifact step is no longer running');
  }

  const formatOf = (version: ArtifactVersion) => extname(version.name).slice(1).toLowerCase();

  return {
    source,
    latestFor,
    write,
    writeText: (attempt: AttemptDTO, name: string, text: string) =>
      write(attempt, name, async (file) => {
        await writeFile(file, text, { flag: 'wx' });
        return [];
      }),
    visibleVersions,
    details(id: string) {
      return {
        versions: visibleVersions(id),
        rounds: listTaskEvents(deps.db, id, 0, ARTIFACT_ROUND_EVENT).map(({ payload }) =>
          artifactRoundSchema.parse(payload),
        ),
      };
    },
    assertPublished(attempt: AttemptDTO) {
      const { task, nodeId } = permitted(attempt);
      const key = deps.nodes.get(nodeId).key;
      if (
        (key === ARTIFACT_FIRST_NODE || key.startsWith(ARTIFACT_REVISION_PREFIX)) &&
        !allVersions(task.id).some((version) => version.attemptId === attempt.id)
      )
        throw new AppError(
          ErrorCode.ValidationFailed,
          'Publish the file with a task artifact write tool before submitting',
        );
    },
    fileOf(taskId: string, id: string) {
      const version = versionOf(taskId, id);
      return original(taskId, version);
    },
    async textAt(taskId: string, id: string, limit: number) {
      const version = versionOf(taskId, id);
      const format = formatOf(version);
      const path = original(taskId, version);
      if (format === 'docx' || format === 'xlsx') return { version, ...(await deps.office.fileText(path, limit)) };
      const value = await readFile(path, 'utf8');
      return { version, text: value.slice(0, limit), chars: value.length };
    },
    async preview(taskId: string, id: string, sheet: string | undefined) {
      const version = versionOf(taskId, id);
      const format = formatOf(version);
      const file = original(taskId, version);
      if (format === 'docx' || format === 'xlsx') return deps.office.previewFile(file, sheet);
      const value = await readFile(file, 'utf8');
      return {
        format: format === 'md' ? ('md' as const) : ('txt' as const),
        text: value.slice(0, ARTIFACT_PREVIEW_CHARS),
        truncated: value.length > ARTIFACT_PREVIEW_CHARS,
      };
    },
    async read(attempt: AttemptDTO, input: Omit<ReadOfficeFileInput, 'path'>) {
      const { task } = permitted(attempt);
      const version = latestFor(attempt);
      if (version === undefined) throw new AppError(ErrorCode.NotFound, 'This task has no artifact yet');
      const format = formatOf(version);
      const file = original(task.id, version);
      if (format === 'docx' || format === 'xlsx') return deps.office.readFile(file, { ...input, path: version.name });
      const value = await readFile(file, 'utf8');
      const text = value.slice(input.cursor, input.cursor + ATTACHMENT_READ_MAX_CHARS);
      const end = input.cursor + text.length;
      return {
        path: version.name,
        format: format === 'md' ? ('md' as const) : ('txt' as const),
        text,
        total_chars: value.length,
        next_cursor: end < value.length ? end : null,
        next_range: null,
      };
    },
  };
}
