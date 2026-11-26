import {
  AppError,
  AttemptStatus,
  DECK_MATERIALS_MAX_CHARS,
  type DesignDTO,
  ErrorCode,
  type GitComparisonItemDTO,
  type GitReviewDTO,
} from '@aw/shared';

function invalidMaterial(message: string): never {
  throw new AppError(ErrorCode.ValidationFailed, message, { issues: [{ path: ['materials'], message }] });
}

function boundedText(lines: string[]) {
  const text = lines.join('\n');
  if (text.length <= DECK_MATERIALS_MAX_CHARS) return text;
  const suffix = '\n… [Material truncated]';
  const prefix = text.slice(0, DECK_MATERIALS_MAX_CHARS - suffix.length).toWellFormed();
  return prefix + suffix;
}

export function renderDesignMaterial(design: DesignDTO) {
  const sections = design.sections.flatMap((section) =>
    section.selected && section.blocks !== null ? [{ ...section, blocks: section.blocks }] : [],
  );
  if (sections.length === 0) invalidMaterial(`Design ${design.id} has no completed section`);
  const { branch, commitSha, dirty } = design.sourceSnapshot;
  const lines = [
    `# Project design · ${design.title}`,
    `Baseline: ${commitSha ?? 'no commit'} · branch ${branch ?? 'unknown'} · snapshot ${dirty ? 'dirty' : 'clean'}`,
    `Coverage: ${sections.length}/${design.totalSections} completed sections`,
  ];
  const sectionIds = new Set(sections.map(({ id }) => id));
  for (const section of sections) {
    lines.push('', `## ${section.title}`, section.summary);
    for (const block of section.blocks) {
      switch (block.type) {
        case 'submodule':
          lines.push(`- Submodule: ${block.title} — ${block.summary}`);
          break;
        case 'transaction': {
          const identity = [block.code, block.channel, block.version, block.scenario].filter(Boolean).join(' · ');
          lines.push(`- Transaction: ${block.title}${identity === '' ? '' : ` (${identity})`}`);
          break;
        }
      }
    }
  }
  for (const diagram of design.diagrams) {
    if (!sectionIds.has(diagram.sectionId) || diagram.edges.length === 0) continue;
    const labels = new Map(diagram.nodes.map(({ id, label }) => [id, label]));
    lines.push('', `## Relations · ${diagram.title}`);
    for (const edge of diagram.edges) {
      lines.push(
        `- ${labels.get(edge.from) ?? edge.from} → ${labels.get(edge.to) ?? edge.to} · ${edge.kind}${edge.label === undefined ? '' : ` · ${edge.label}`} (${edge.evidenceClass})`,
      );
    }
  }
  return { title: design.title, content: boundedText(lines) };
}

function comparisonLine(item: GitComparisonItemDTO) {
  return `- [${item.status}] ${item.title}${item.detail === undefined ? '' : ` — ${item.detail}`}`;
}

export function renderGitReviewMaterial(review: GitReviewDTO) {
  if (review.status !== AttemptStatus.Succeeded || review.summary === null)
    invalidMaterial(`Git review ${review.id} has no completed report`);
  const lines = [
    `# Git review · ${review.label}`,
    `Target: ${review.target} · ${review.from} → ${review.to ?? 'working tree'}`,
    `Design snapshot: ${review.designSnapshotSha ?? 'none'} (${review.designMatch})`,
    ...(review.focus === null ? [] : [`Focus: ${review.focus}`]),
    ...(review.impactTruncated ? ['The design impact screening was truncated.'] : []),
    '',
    '## Conclusion',
    review.summary,
  ];
  if (review.comparison !== undefined) {
    const comparison = review.comparison;
    lines.push(
      '',
      '## Version comparison',
      `Design matches: ${comparison.fromMatch} → ${comparison.toMatch}`,
      comparison.summary,
      '',
      '### Architecture changes',
      ...comparison.sections.map(comparisonLine),
      '',
      '### Transaction changes',
      ...comparison.transactions.map(comparisonLine),
    );
  }
  const checks = new Set([...review.regressionChecks, ...review.impacts.flatMap((impact) => impact.suggestedChecks)]);
  if (checks.size > 0) {
    lines.push('', '## Regression checks', ...Array.from(checks, (check) => `- ${check}`));
  }
  if (review.findings.length > 0) {
    lines.push('', '## Code findings');
    for (const finding of review.findings) {
      const location = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
      lines.push(`- [${finding.severity}] ${finding.title} (${location}) — ${finding.description}`);
      if (finding.suggestion !== undefined) lines.push(`  - Suggested fix: ${finding.suggestion}`);
    }
  }
  const impacts = Map.groupBy(review.impacts, (impact) => impact.classification);
  for (const [classification, items] of impacts) {
    lines.push('', `## Business impact · ${classification}`);
    for (const impact of items) {
      lines.push(`- ${impact.title} (${impact.targetKind}; ${impact.evidenceClass}) — ${impact.reason}`);
    }
  }
  return { title: review.label, content: boundedText(lines) };
}
