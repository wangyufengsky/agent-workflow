import { DesignKnowledgeMatch } from '@aw/shared';
import { createProjectKnowledgeReader, type KnowledgeSelection, readProjectKnowledge } from './designs.knowledge.ts';
import type { createDesignsRepo } from './designs.repo.ts';
import { findFreshDesign } from './designs.staleness.ts';

export type ReviewKnowledgeSelection = KnowledgeSelection & { worktreeFresh: boolean };

export function createReviewKnowledgeReader(repo: ReturnType<typeof createDesignsRepo>) {
  const readKnowledge = createProjectKnowledgeReader(repo);
  return async (projectId: string, targetSha: string | null, repoPath: string): Promise<ReviewKnowledgeSelection> => {
    if (targetSha !== null) return { ...readKnowledge(projectId, targetSha), worktreeFresh: false };

    const candidates = repo.listKnowledgeDesigns(projectId);
    if (candidates.length === 0) return { match: DesignKnowledgeMatch.Missing, knowledge: null, worktreeFresh: false };
    const fresh = await findFreshDesign(repo, candidates, repoPath);
    // 文件扫描期间设计可能被删除。
    const currentFresh = fresh === undefined ? undefined : repo.findDesign(fresh.id);
    const design = currentFresh ?? repo.findLatestKnowledgeDesign(projectId);
    if (design === undefined) return { match: DesignKnowledgeMatch.Missing, knowledge: null, worktreeFresh: false };
    // 工作区可继续变化，没有用于 exact 匹配的不可变目标 SHA。
    return {
      match: DesignKnowledgeMatch.Reference,
      knowledge: readProjectKnowledge(repo, design),
      worktreeFresh: currentFresh !== undefined,
    };
  };
}
