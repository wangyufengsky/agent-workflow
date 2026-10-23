import { RequirementConclusion, type RequirementResultDTO, RequirementResultSource } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { displayStatus } from './requirements.status.ts';

const baseline = { revisionId: 'v2', commitSha: 'c2' };

let n = 0;
function result(conclusion: RequirementConclusion, over: Partial<RequirementResultDTO> = {}): RequirementResultDTO {
  n += 1;
  return {
    id: `r${n}`,
    itemId: 'i1',
    revisionId: 'v2',
    source: conclusion === RequirementConclusion.Waive ? RequirementResultSource.User : RequirementResultSource.Ai,
    conclusion,
    note: '',
    output: null,
    commitSha: 'c2',
    createdAt: n,
    ...over,
  };
}

describe('验收项的显示状态（31 §3）', () => {
  it('没有结论时未核验', () => {
    expect(displayStatus([], baseline).status).toBe('unverified');
  });

  it('当前版本、当前提交下按最新结论：通过、未通过、未核验、接受未完成', () => {
    expect(displayStatus([result('pass')], baseline).status).toBe('passed');
    expect(displayStatus([result('fail')], baseline).status).toBe('failed');
    expect(displayStatus([result('unverified')], baseline).status).toBe('unverified');
    expect(displayStatus([result('waive')], baseline).status).toBe('waived');
  });

  it('取最新的一条，不管是谁给的：之前的失败被后来的用户通过盖过，反之亦然', () => {
    const failThenUser = [result('fail'), result('pass', { source: RequirementResultSource.User })];
    expect(displayStatus(failThenUser, baseline)).toMatchObject({ status: 'passed', latest: { source: 'user' } });
    expect(displayStatus([result('pass'), result('fail')], baseline).status).toBe('failed');
  });

  it('最新结论属于旧版本或旧提交时过期，包括用户的结论', () => {
    expect(displayStatus([result('pass', { revisionId: 'v1' })], baseline).status).toBe('stale');
    expect(displayStatus([result('pass', { commitSha: 'c1' })], baseline).status).toBe('stale');
    expect(displayStatus([result('waive', { commitSha: 'c1' })], baseline).status).toBe('stale');
  });

  it('不知道当前提交（工作区已删除）时只比较版本', () => {
    const unknown = { revisionId: 'v2', commitSha: null };
    expect(displayStatus([result('pass', { commitSha: 'c1' })], unknown).status).toBe('passed');
    expect(displayStatus([result('pass', { revisionId: 'v1' })], unknown).status).toBe('stale');
  });
});
