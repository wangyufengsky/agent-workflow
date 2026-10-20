import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AttemptStatus, ServerEventType, startDebugAttemptOp, type TranscriptEntry } from '@aw/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../../test/helpers/app.ts';
import { waitForEvent } from '../../../test/helpers/events.ts';
import { createTestRepo } from '../../../test/helpers/git.ts';

/**
 * The one `@opencode` test that calls a model (07 §2): only a model can make opencode run a tool. A free model keeps
 * it at no cost (D42); override with AW_OC_TEST_MODEL.
 */
const MODEL = process.env.AW_OC_TEST_MODEL ?? 'opencode/beam-free';
const SESSION_TIMEOUT_MS = 110_000;

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({ realOpencode: true });
  await t.app.start(t.port);
});
afterEach(() => t.close());

describe('@opencode bridge 插件', () => {
  it('MCP 工具收到调用会话的 sessionID，调试尝试经 submit_result 成功', async () => {
    const repo = await createTestRepo();
    const ended = waitForEvent(
      t.app.events,
      ServerEventType.AttemptUpdated,
      (d) => d.attempt.status !== AttemptStatus.Starting && d.attempt.status !== AttemptStatus.Running,
      SESSION_TIMEOUT_MS,
    );
    const { body: attempt } = await t.call(startDebugAttemptOp, {
      directory: repo.path,
      requirement:
        'This is a connectivity check. Do not read or change any files. Call agent-workflow_get_task_context, ' +
        'then call agent-workflow_submit_result with the summary "bridge ok".',
      model: MODEL,
    });
    const result = (await ended).attempt;

    const transcript = (await readFile(join(t.dataDir, 'runs', 'debug', `${attempt.id}.jsonl`), 'utf8'))
      .trim()
      .split('\n')
      .map((line): TranscriptEntry => JSON.parse(line));
    const toolResults = transcript.flatMap((e) => (e.kind === 'tool_result' ? [e.data] : []));
    // Every call of our tools was attributed to this attempt: none came back unresolved.
    expect(toolResults.filter((r) => r.tool.startsWith('agent-workflow_'))).not.toHaveLength(0);
    expect(JSON.stringify(toolResults)).not.toContain('MCP_ATTEMPT_UNRESOLVED');
    expect(result).toMatchObject({ id: attempt.id, status: AttemptStatus.Succeeded });
  });
});
