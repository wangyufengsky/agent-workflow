import { readdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ATTACHMENT_BYTES_MAX,
  ATTACHMENT_NAME_HEADER,
  ATTACHMENT_ORPHAN_TTL_MS,
  ATTACHMENTS_DIR,
  ATTACHMENTS_PER_INPUT_MAX,
  type AttachmentDTO,
  AttachmentOwnerKind,
  createProjectOp,
  ErrorCode,
  getAttachmentOp,
  removeAttachmentOp,
  snapshotProjectFileOp,
} from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createFakeClock } from '../../../test/helpers/clock.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';

const HOUR = 60 * 60 * 1000;

let t: TestApp;
let clock: ReturnType<typeof createFakeClock>;
beforeEach(async () => {
  clock = createFakeClock();
  t = await createTestApp({ clock });
});
afterEach(() => t.close());

const upload = (content: string | Buffer, name = 'notes.md') =>
  t.request({
    method: 'POST',
    url: '/attachments',
    headers: { 'content-type': 'application/octet-stream', [ATTACHMENT_NAME_HEADER]: encodeURIComponent(name) },
    payload: content,
  });
const uploaded = async (content: string, name?: string): Promise<AttachmentDTO> => {
  const res = await upload(content, name);
  expect(res.statusCode).toBe(201);
  return res.json();
};
const contentOf = async (id: string) => (await t.request({ method: 'GET', url: `/attachments/${id}/content` })).body;
const storedDirs = () => readdir(join(t.dataDir, ATTACHMENTS_DIR));
const service = () => t.app.services.attachments;
const task = (id: string) => ({ kind: AttachmentOwnerKind.TaskInput, id });

async function addProject(files: Record<string, string>) {
  const repo = await createTestRepo({ files });
  const project = (await t.call(createProjectOp, { repoPath: repo.path })).body;
  return { repo, project };
}

describe('上传', () => {
  it('UTF-8 文本按原样保存，可以读回元信息与内容', async () => {
    const text = '# 需求\n订单列表要能搜索\n';
    const attachment = await uploaded(text, '需求 说明.md');
    expect(attachment).toMatchObject({
      source: 'upload',
      name: '需求 说明.md',
      sizeBytes: Buffer.byteLength(text),
      origin: null,
    });
    expect((await t.call(getAttachmentOp, { id: attachment.id })).body).toEqual(attachment);
    expect(await contentOf(attachment.id)).toBe(text);
  });

  it('不是文本或超过大小时拒绝，不留下记录和文件', async () => {
    const invalid = [
      [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]), ErrorCode.AttachmentInvalidType],
      ['a\0b', ErrorCode.AttachmentInvalidType],
      ['x'.repeat(ATTACHMENT_BYTES_MAX + 1), ErrorCode.AttachmentTooLarge],
    ] as const;
    for (const [content, code] of invalid) {
      expect((await upload(content)).json().error.code).toBe(code);
    }
    expect(await storedDirs()).toEqual([]);
  });
});

describe('项目文件快照', () => {
  it('保存读取时的内容与来源；之后文件改变不影响它', async () => {
    const { repo, project } = await addProject({ 'src/order.ts': 'line 1\nline 2\nline 3\nline 4\n' });
    const whole = (await t.call(snapshotProjectFileOp, { projectId: project.id, path: 'src/order.ts' })).body;
    const part = (
      await t.call(snapshotProjectFileOp, { projectId: project.id, path: 'src/order.ts', lines: { from: 2, to: 3 } })
    ).body;
    await writeFile(join(repo.path, 'src/order.ts'), 'changed\n');

    expect(whole).toMatchObject({
      source: 'project_file',
      name: 'order.ts',
      origin: { projectId: project.id, taskId: null, path: 'src/order.ts', lines: null },
    });
    expect(part.name).toBe('order.ts:2-3');
    expect(await contentOf(whole.id)).toBe('line 1\nline 2\nline 3\nline 4\n');
    expect(await contentOf(part.id)).toBe('line 2\nline 3\n');
  });

  it('项目目录之外、.git 里、不存在的文件、超出末尾的行号与没有工作区的任务都拒绝', async () => {
    const { repo, project } = await addProject({ 'a.ts': 'one\n' });
    const outside = await createTestRepo({ files: { 'secret.txt': 'secret\n' } });
    await symlink(join(outside.path, 'secret.txt'), join(repo.path, 'link.txt'));
    const requests = [
      { path: '../outside.txt' },
      { path: join(outside.path, 'secret.txt') },
      { path: 'link.txt' },
      { path: '.git/config' },
      { path: 'missing.ts' },
      { path: 'a.ts', lines: { from: 1, to: 2 } },
      { path: 'a.ts', taskId: 'no-such-task' },
    ];
    for (const request of requests) {
      const res = await t.call(snapshotProjectFileOp, { projectId: project.id, ...request });
      expect(res.body).toMatchObject({ error: { code: ErrorCode.AttachmentSourceInvalid } });
    }
  });
});

describe('引用与清理', () => {
  it('被引用的附件一直保留；最后一个引用释放、超过保留时间后才删除', async () => {
    const attachment = await uploaded('shared\n');
    service().bind(task('t1'), [attachment.id]);
    service().bind({ kind: AttachmentOwnerKind.AssistantMessage, id: 'c1' }, [attachment.id]);
    expect((await t.call(removeAttachmentOp, { id: attachment.id })).status).toBe(400);

    clock.advance(ATTACHMENT_ORPHAN_TTL_MS + HOUR);
    service().release(AttachmentOwnerKind.TaskInput, ['t1']);
    await service().cleanup();
    expect(service().listByOwner({ kind: AttachmentOwnerKind.AssistantMessage, id: 'c1' })).toEqual([attachment]);

    service().release(AttachmentOwnerKind.AssistantMessage, ['c1']);
    await service().cleanup();
    expect((await t.call(getAttachmentOp, { id: attachment.id })).status).toBe(404);
    expect(await storedDirs()).toEqual([]);
  });

  it('未发送的附件超过保留时间后删除，之后再发送它得到 ATTACHMENT_NOT_FOUND', async () => {
    const old = await uploaded('old\n');
    clock.advance(ATTACHMENT_ORPHAN_TTL_MS + HOUR);
    const recent = await uploaded('recent\n');
    await service().cleanup();

    expect((await t.call(getAttachmentOp, { id: old.id })).status).toBe(404);
    expect(await storedDirs()).toEqual([recent.id]);
    expect(() => service().bind(task('t1'), [old.id, recent.id])).toThrow(
      expect.objectContaining({ code: ErrorCode.AttachmentNotFound }),
    );
    expect(service().listByOwner(task('t1'))).toEqual([]);
  });

  it('没有记录的残留目录按年龄清理', async () => {
    const dir = join(t.dataDir, ATTACHMENTS_DIR, 'left-by-a-crash');
    await writeFile(`${dir}.keep`, '');
    await utimes(`${dir}.keep`, new Date(clock.now()), new Date(clock.now()));
    const stale = new Date(clock.now() - ATTACHMENT_ORPHAN_TTL_MS - HOUR);
    await writeFile(dir, '');
    await utimes(dir, stale, stale);
    await service().cleanup();
    expect(await storedDirs()).toEqual(['left-by-a-crash.keep']);
  });

  it('按顺序绑定；一次最多 ATTACHMENTS_PER_INPUT_MAX 个', async () => {
    const [a, b] = [await uploaded('a\n', 'a.md'), await uploaded('b\n', 'b.md')];
    service().bind(task('t1'), [b.id, a.id]);
    expect(
      service()
        .listByOwner(task('t1'))
        .map((x) => x.name),
    ).toEqual(['b.md', 'a.md']);

    const many = Array.from({ length: ATTACHMENTS_PER_INPUT_MAX + 1 }, () => a.id);
    expect(() => service().bind(task('t2'), many)).toThrow(
      expect.objectContaining({ code: ErrorCode.AttachmentTooLarge }),
    );
  });

  it('未发送的附件可以移除', async () => {
    const attachment = await uploaded('draft\n');
    expect((await t.call(removeAttachmentOp, { id: attachment.id })).status).toBe(204);
    expect((await t.call(getAttachmentOp, { id: attachment.id })).status).toBe(404);
    expect(await storedDirs()).toEqual([]);
  });
});
