import {
  AppError,
  ErrorCode,
  type FunctionalTestCase,
  type FunctionalTestReport,
  type FunctionalTestRun,
  type FunctionalTestSnapshot,
  FunctionalTestStatus,
  type functionalTestReportSubmitSchema,
} from '@aw/shared';
import type { z } from 'zod';
import { redactText } from './functional-tests.http.ts';

export function latestCases(snapshot: FunctionalTestSnapshot): FunctionalTestCase[] {
  return [...new Map(snapshot.cases.map((test) => [test.id, test])).values()];
}

function renderReport(
  snapshot: FunctionalTestSnapshot,
  run: FunctionalTestRun,
  report: Omit<FunctionalTestReport, 'markdown'>,
  input: z.output<typeof functionalTestReportSubmitSchema>,
) {
  const { counts } = report;
  const { environment } = run;
  const status = {
    passed: '通过',
    failed: '失败',
    blocked: '阻塞',
    not_run: '未执行',
    running: '执行中',
  };
  const lines = [
    '# 功能测试报告',
    '',
    `环境：${environment.target}`,
    `被测基线：${environment.baseline ?? '未核实'}${environment.verified ? '' : '（未核实）'}`,
    `用例 ${report.items.length} 条。通过 ${counts.passed}，失败 ${counts.failed}，阻塞 ${counts.blocked}，未执行 ${counts.not_run}。`,
  ];
  if (counts.passed > 0 && counts.passed === report.items.length) lines.push('全部通过。');
  if (environment.reason !== null) lines.push(`环境问题：${environment.reason}`);
  for (const check of environment.checks)
    lines.push(`- 条件 ${redactText(check.key)}：${check.ready ? '就绪' : check.reason}`);
  const revisionCount = snapshot.events.filter(
    (event) => event.runId === run.id && event.kind === 'revision' && event.detail.pending === false,
  ).length;
  lines.push(`已应用用例修订：${revisionCount}。`);
  const revision = (test: FunctionalTestCase) => `v${test.version}`;
  for (const item of report.items) {
    lines.push('', `## ${item.number} ${redactText(item.title)} · v${item.version} · ${status[item.status]}`, '');
    const test = snapshot.cases.find(({ id, version }) => id === item.caseId && version === item.version);
    if (test === undefined) throw new Error('Report references missing case version');
    lines.push(redactText(test.requirement));
    if (test.source !== undefined)
      lines.push(
        `来源：${test.source.attachmentId} ${test.source.originalId ?? ''} ${redactText(test.source.location)}`,
      );
    if (test.needsClarification !== undefined) lines.push(`待澄清：${redactText(test.needsClarification)}`);
    if (test.preconditions.length > 0) lines.push(`前置条件：${redactText(test.preconditions.join('、'))}`);
    if (test.data.length > 0) lines.push(`测试数据：${redactText(test.data)}`);
    for (const step of test.steps) lines.push(`- ${redactText(step.title)}`);
    const changes = snapshot.events.filter(
      (event) =>
        event.caseId === item.caseId &&
        event.runId === run.id &&
        event.kind === 'revision' &&
        event.detail.pending === false,
    );
    for (const execution of snapshot.executions.filter(
      ({ runId, caseId }) => runId === run.id && caseId === item.caseId,
    )) {
      const corrected = changes.some(
        (event) =>
          event.executionId === execution.id &&
          event.detail.contractPath !== undefined &&
          event.detail.author !== 'user',
      );
      lines.push('', `### v${execution.version} 实测 · ${corrected ? '阻塞 · 用例问题' : status[execution.status]}`);
      if (corrected) lines.push(`原始判定：${status[execution.status]}。以下为当时保留的实测值。`);
      for (const event of snapshot.events.filter(({ executionId }) => executionId === execution.id)) {
        if (
          event.kind !== 'action' &&
          event.kind !== 'assertion' &&
          event.kind !== 'result' &&
          event.kind !== 'cleanup'
        )
          continue;
        const facts = JSON.stringify(event.detail).replace(/\n/g, ' ').replace(/`/g, '\\u0060');
        lines.push(
          `- 证据 #${event.seq} · ${event.step === null ? '' : `步骤 ${event.step + 1} · `}${event.message} · \`${facts}\``,
        );
      }
      const finding = input.findings?.find(({ executionId }) => executionId === execution.id);
      if (finding !== undefined) lines.push('', redactText(finding.description));
    }
    for (const event of changes) {
      lines.push('', `修订 #${event.seq}：${String(event.detail.reason)}（依据：${String(event.detail.basis)}）`);
    }
    const old = snapshot.cases.filter(({ id, version }) => id === item.caseId && version < item.version);
    if (old.length > 0) lines.push('', `用例修订：${old.map(revision).join('、')} → ${revision(test)}`);
  }
  if ((input.uncovered?.length ?? 0) > 0)
    lines.push('', '## 未覆盖范围', '', ...(input.uncovered ?? []).map((line) => `- ${redactText(line)}`));
  return lines.join('\n');
}

export function makeReport(
  snapshot: FunctionalTestSnapshot,
  run: FunctionalTestRun,
  input: z.output<typeof functionalTestReportSubmitSchema>,
  now: number,
): FunctionalTestReport {
  const executions = snapshot.executions.filter(({ runId }) => runId === run.id);
  const requested = new Set(input.executionIds);
  if (
    executions.some(({ id, status }) => !requested.has(id) || status === FunctionalTestStatus.Running) ||
    requested.size !== executions.length ||
    requested.size !== input.executionIds.length ||
    input.findings?.some(({ executionId }) => !requested.has(executionId))
  ) {
    throw new AppError(
      ErrorCode.ValidationFailed,
      'Reference every finished execution in the selected run exactly once',
    );
  }
  const current = new Map(executions.map((execution) => [execution.caseId, execution]));
  const counts = { passed: 0, failed: 0, blocked: 0, not_run: 0 };
  const items = latestCases(snapshot).map(({ id: caseId, number, title, version, needsClarification }) => {
    const newest = current.get(caseId);
    const execution = newest?.version === version ? newest : undefined;
    const awaitingDecision = snapshot.events.some(
      (event) =>
        event.kind === 'revision' &&
        event.runId === run.id &&
        event.caseId === caseId &&
        event.detail.from === version &&
        event.detail.pending === true,
    );
    const status = awaitingDecision
      ? FunctionalTestStatus.Blocked
      : (execution?.status ??
        (run.environment.ready && needsClarification === undefined
          ? FunctionalTestStatus.NotRun
          : FunctionalTestStatus.Blocked));
    if (status === FunctionalTestStatus.Running) throw new Error('A report cannot include active executions');
    counts[status]++;
    return { caseId, number, title, version, status, executionId: execution?.id ?? null };
  });
  const report = { runId: run.id, version: snapshot.reports.length + 1, createdAt: now, counts, items };
  return { ...report, markdown: renderReport(snapshot, run, report, input) };
}
