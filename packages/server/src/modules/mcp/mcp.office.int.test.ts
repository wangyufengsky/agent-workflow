import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttemptKind, ErrorCode, MCP_SESSION_ARG, McpToolName, RoleBaseAgent } from '@aw/shared';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { script } from '../../../test/fakes/fake-opencode.ts';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';
import { callTool, connectMcp } from '../../../test/helpers/mcp.ts';

let t: TestApp;
let mcp: Client;
beforeEach(async () => {
  t = await createTestApp();
  mcp = await connectMcp(t.mcpUrl, t.app.mcpToken);
});
afterEach(async () => {
  await mcp.close();
  await t.close();
});

const fixture = (name: string) => readFile(new URL(`../../../test/fixtures/office/${name}`, import.meta.url));

/** An attempt of `kind` working in a repository holding the samples under docs/. */
async function sessionIn(kind: AttemptKind) {
  t.fake.enqueue(script().hang());
  const repo = await createTestRepo({
    files: {
      'docs/需求.docx': await fixture('report.libreoffice.docx'),
      'docs/销售.xlsx': await fixture('sales.libreoffice.xlsx'),
      'docs/notes.md': '# notes\n',
    },
  });
  const attempt = await t.app.services.attempts.start({
    kind,
    agent: RoleBaseAgent.Executor,
    taskId: null,
    projectId: null,
    nodeId: null,
    roleId: null,
    directory: repo.path,
    title: 'T-1 · office',
    model: null,
    prompt: 'hello',
  });
  if (attempt.opencodeSessionId === null) throw new Error('attempt has no session');
  const session = attempt.opencodeSessionId;
  return {
    repo,
    read: (args: Record<string, unknown>) =>
      callTool(mcp, McpToolName.ReadOfficeFile, { [MCP_SESSION_ARG]: session, ...args }),
  };
}

describe('read_office_file（39 §7.3）', () => {
  it('Word 分页读正文；Excel 先给概览，再按工作表与区域分页读行', async () => {
    const { read } = await sessionIn(AttemptKind.Execute);

    const word = await read({ path: 'docs/需求.docx' });
    expect(word).toMatchObject({
      isError: false,
      body: { path: 'docs/需求.docx', format: 'docx', next_cursor: null, next_range: null },
    });
    expect(word.body.text).toContain('| order_id | string | 订单号 |');
    const tail = await read({ path: 'docs/需求.docx', cursor: 10 });
    expect(tail.body.text).toBe((word.body.text as string).slice(10));

    const overview = await read({ path: './docs/销售.xlsx' });
    expect(overview.body).toMatchObject({ path: 'docs/销售.xlsx', format: 'xlsx', total_chars: null });
    expect(overview.body.text).toContain('## 工作表「汇总」（A1:B7，7 行 × 2 列）');

    const rows = await read({ path: 'docs/销售.xlsx', sheet: '汇总', range: 'A5:B7' });
    expect(rows.body).toMatchObject({
      text: '## 工作表「汇总」（A5:B7）\n\n| 行 | A | B |\n| --- | --- | --- |\n| 5 | 华南 | 700 |\n| 6 | 合计 | 2791.5 |\n| 7 | 备注：金额含税 \\| 单位元 |  |',
      next_range: null,
    });
  });

  it('不是 Word / Excel、在工作目录外、经链接指到外面时拒绝；只给读项目的会话', async () => {
    const { repo, read } = await sessionIn(AttemptKind.Research);
    const outside = await mkdtemp(join(tmpdir(), 'aw-outside-'));
    await writeFile(join(outside, 'secret.xlsx'), await fixture('sales.libreoffice.xlsx'));
    await symlink(join(outside, 'secret.xlsx'), join(repo.path, 'link.xlsx'));

    expect((await read({ path: 'docs/notes.md' })).body).toMatchObject({ code: ErrorCode.ValidationFailed });
    for (const path of ['../x.xlsx', join(outside, 'secret.xlsx'), 'link.xlsx']) {
      expect((await read({ path })).body).toMatchObject({
        code: ErrorCode.AttachmentSourceInvalid,
        details: { reason: 'outside' },
      });
    }
    expect((await read({ path: 'docs/没有.xlsx' })).body).toMatchObject({ details: { reason: 'missing' } });

    const review = await sessionIn(AttemptKind.GitReview);
    expect((await review.read({ path: 'docs/销售.xlsx' })).body).toMatchObject({ code: ErrorCode.McpToolNotAllowed });
  });
});
