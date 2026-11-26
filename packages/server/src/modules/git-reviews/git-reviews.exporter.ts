import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import {
  AppError,
  ErrorCode,
  FindingSeverity,
  type GitComparisonDTO,
  type GitComparisonItemDTO,
  GitImpactClassification,
  type GitReviewDTO,
  GitReviewTarget,
} from '@aw/shared';
import copy from '../../../../../apps/web/src/copy/git-review-site.json' with { type: 'json' };
import {
  canonicalExportTarget,
  exportPathMetadata,
  invalidExportTarget,
  withExportTargetLock,
} from '../../core/offline-export.ts';

const REPORT_NAME = 'index.html';
const REPORT_PREFIX = '<!doctype html>\n<!-- agent-workflow:git-review:';
const markerFor = (reviewId: string) => `${REPORT_PREFIX}${createHash('sha256').update(reviewId).digest('hex')} -->\n`;

const THEME_AND_FILTERS = `(() => {
  const theme = document.getElementById('theme');
  theme.addEventListener('change', () => { document.documentElement.dataset.theme = theme.value; });
  for (const records of document.querySelectorAll('[data-records]')) {
    const filters = [...records.querySelectorAll('select')];
    const cards = [...records.querySelectorAll('article')];
    const empty = records.querySelector('[data-filter-empty]');
    for (const filter of filters) filter.addEventListener('change', () => {
      let count = 0;
      for (const card of cards) {
        card.hidden = !filters.every(({ name, value }) => !value || card.dataset[name] === value);
        if (!card.hidden) count++;
      }
      empty.hidden = count !== 0 || cards.length === 0;
    });
  }
})();`;

const STYLES = `
:root {
  color-scheme: light dark;
  font: 16px/1.6 system-ui, sans-serif;
  --background: light-dark(#f3f5f9, #151922);
  --surface: light-dark(#fff, #202632);
  --border: light-dark(#cbd2e0, #4b5568);
  --secondary: light-dark(#4e596d, #b6c2d7);
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"] { color-scheme: dark; }
body { background: var(--background); color: CanvasText; margin: 0 auto; max-width: 64rem; padding: 2rem 1rem; }
header, section { margin-block-end: 2.5rem; }
nav, .filters { display: flex; flex-wrap: wrap; gap: .75rem 1.25rem; margin-block: .75rem; }
nav a { color: LinkText; }
article, .statistics div { background: var(--surface); border: 1px solid var(--border); border-radius: .6rem; padding: .8rem 1rem; }
article { margin-block: .75rem; }
.statistics { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: .75rem; }
.statistics dt, .meta { color: var(--secondary); }
.statistics dd { margin: 0; font-size: 1.7rem; font-weight: 650; }
h1, h2, h3, h4, p { margin-block: 0 .6rem; }
h1, h2, h3, h4 { line-height: 1.3; overflow-wrap: anywhere; }
code, .body-text { overflow-wrap: anywhere; white-space: pre-wrap; }
select { font: inherit; }
[hidden] { display: none !important; }
`;

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function select(name: string, label: string, values: Record<string, string>): string {
  const options = Object.entries(values)
    .map(([key, text]) => `<option value="${key}">${text}</option>`)
    .join('');
  return `<label>${label} <select name="${name}"><option value="">${copy.filters.all}</option>${options}</select></label>`;
}

function checks(items: readonly string[], text: (item: string) => string): string {
  return items.length === 0
    ? ''
    : `<ul>${items.map((item) => `<li class="body-text">${text(item)}</li>`).join('')}</ul>`;
}

function findingsSection(review: GitReviewDTO, text: (value: string) => string): string {
  const impactLinks = new Map(review.impacts.map((impact, index) => [impact.id, { title: impact.title, index }]));
  const articles = review.findings.map((finding) => {
    const line =
      finding.line === undefined
        ? ''
        : `:${finding.line}${finding.end_line === undefined ? '' : `–${finding.end_line}`}`;
    const related = (finding.affectedImpactIds ?? []).flatMap((id) => {
      const impact = impactLinks.get(id);
      return impact === undefined ? [] : [`<a href="#impact-${impact.index}">${text(impact.title)}</a>`];
    });
    return `<article data-severity="${finding.severity}" data-status="${finding.status}">
      <h3>${text(finding.title)}</h3>
      <p>${copy.severity[finding.severity]} · ${copy.category[finding.category]} · ${copy.status[finding.status]}</p>
      <p><code>${text(finding.path)}${line}</code></p>
      <p class="body-text">${text(finding.description)}</p>
      ${finding.suggestion === undefined ? '' : `<p class="body-text"><strong>${copy.suggestion}</strong> ${text(finding.suggestion)}</p>`}
      ${related.length === 0 ? '' : `<p>${copy.relatedImpacts} ${related.join('、')}</p>`}
    </article>`;
  });
  return `<section id="findings" data-records><h2>${copy.findings}</h2>
    ${articles.length === 0 ? `<p>${copy.noFindings}</p>` : `<div class="filters">${select('severity', copy.filters.severity, copy.severity)}${select('status', copy.filters.status, copy.status)}</div>`}
    <p data-filter-empty hidden>${copy.noFilteredFindings}</p>${articles.join('')}</section>`;
}

function impactsSection(review: GitReviewDTO, text: (value: string) => string): string {
  const articles = review.impacts.map((impact, index) => {
    const line =
      impact.lineStart === undefined
        ? ''
        : `:${impact.lineStart}${impact.lineEnd === undefined ? '' : `–${impact.lineEnd}`}`;
    return `<article id="impact-${index}" data-classification="${impact.classification}" data-evidence="${impact.evidenceClass}">
      <h3>${text(impact.title)}</h3>
      <p>${copy.classification[impact.classification]} · ${copy.evidence[impact.evidenceClass]} · ${copy.kind[impact.targetKind]}</p>
      ${impact.relPath === undefined ? '' : `<p><code>${text(impact.relPath)}</code></p>`}
      <p class="body-text">${text(impact.reason)}</p>
      ${impact.evidencePath === undefined ? '' : `<p>${copy.source} <code>${text(impact.evidencePath)}${line}</code></p>`}
      ${checks(impact.suggestedChecks, text)}
    </article>`;
  });
  return `<section id="impacts" data-records><h2>${copy.impacts}</h2>
    ${review.impactTruncated ? `<p>${copy.truncated}</p>` : ''}
    ${review.uncoveredPaths.length === 0 ? '' : `<details><summary>${copy.uncoveredPaths}（${review.uncoveredPaths.length}）</summary>${checks(review.uncoveredPaths, text)}</details>`}
    ${articles.length === 0 ? `<p>${copy.noImpacts}</p>` : `<div class="filters">${select('classification', copy.filters.classification, copy.classification)}${select('evidence', copy.filters.evidence, copy.evidence)}</div>`}
    <p data-filter-empty hidden>${copy.noFilteredImpacts}</p>${articles.join('')}</section>`;
}

function reportStatistics(review: GitReviewDTO): string {
  const minor = review.findings.filter(({ severity }) => severity === FindingSeverity.Minor).length;
  const possible = review.impacts.filter(
    ({ classification }) => classification === GitImpactClassification.Possible,
  ).length;
  const metrics = [
    [copy.counts.importantFindings, review.findings.length - minor],
    [copy.counts.minorFindings, minor],
    [copy.counts.directOrIndirectImpacts, review.impacts.length - possible],
    [copy.counts.possibleImpacts, possible],
  ];
  return `<dl class="statistics">${metrics.map(([label, count]) => `<div><dt>${label}</dt><dd>${count}</dd></div>`).join('')}</dl>`;
}

function completionTime(finishedAt: number | null): string {
  if (finishedAt === null) return '';
  const time = new Date(finishedAt);
  const label = time.toLocaleString(copy.language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return `<p class="meta">${copy.finishedAt} <time datetime="${time.toISOString()}">${escapeHtml(label)}</time></p>`;
}

function comparisonItems(title: string, items: GitComparisonItemDTO[], text: (value: string) => string): string {
  const labels = copy.comparison;
  const articles = items.map((item) => {
    const paths = (
      [
        [labels.from, item.fromPath],
        [labels.to, item.toPath],
      ] as const
    ).flatMap(([label, path]) => (path === undefined ? [] : [`<p>${label} <code>${text(path)}</code></p>`]));
    return `<article>
      <h4>${text(item.title)}</h4>
      <p>${labels.status[item.status]}</p>
      ${paths.join('')}
      ${item.detail === undefined ? '' : `<p class="body-text">${text(item.detail)}</p>`}
    </article>`;
  });
  return `<h3>${title}</h3>${articles.length === 0 ? `<p>${labels.empty}</p>` : articles.join('')}`;
}

function comparisonSection(comparison: GitComparisonDTO, text: (value: string) => string): string {
  const labels = copy.comparison;
  return `<section id="comparison"><h2>${labels.title}</h2>
    <h3>${labels.summary}</h3><p class="body-text">${text(comparison.summary)}</p>
    ${comparisonItems(labels.sections, comparison.sections, text)}
    ${comparisonItems(labels.transactions, comparison.transactions, text)}
  </section>`;
}

function comparisonFiles(files: GitReviewDTO['files'], text: (value: string) => string): string {
  const labels = copy.comparison;
  const items = files.map(({ path, oldPath, status, additions, deletions }) => {
    const location = oldPath === undefined ? text(path) : `${text(oldPath)} → ${text(path)}`;
    const stats = additions === null || deletions === null ? '' : ` · +${additions} / −${deletions}`;
    return `<li>${labels.fileStatus[status]} · <code>${location}</code>${stats}</li>`;
  });
  return `<section id="files"><h2>${labels.files}</h2>${items.length === 0 ? `<p>${labels.empty}</p>` : `<ul>${items.join('')}</ul>`}</section>`;
}

function renderReport(review: GitReviewDTO, name: string, privatePaths: string[]): string {
  const redact = (value: string) =>
    privatePaths.reduce((current, path) => current.replaceAll(path, copy.localPath), value);
  const text = (value: string) => escapeHtml(redact(value));
  const hash = (content: string) => `'sha256-${createHash('sha256').update(content).digest('base64')}'`;
  const { comparison } = review;
  const isCompare = review.target === GitReviewTarget.Compare;
  const title = isCompare ? copy.comparison.title : copy.title;
  return `${markerFor(review.id)}<html lang="${copy.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hash(THEME_AND_FILTERS)}; style-src ${hash(STYLES)}; base-uri 'none'; form-action 'none'">
<title>${text(name)} · ${title}</title>
<style>${STYLES}</style>
</head>
<body>
<header id="overview">
<h1>${text(name)} · ${title}</h1>
<label>${copy.theme.label} <select id="theme"><option value="auto">${copy.theme.auto}</option><option value="light">${copy.theme.light}</option><option value="dark">${copy.theme.dark}</option></select></label>
<nav aria-label="${copy.navigation}"><a href="#overview">${copy.overview}</a>${comparison === undefined ? '' : `<a href="#comparison">${copy.comparison.title}</a>`}${isCompare ? `<a href="#files">${copy.comparison.files}</a>` : ''}<a href="#findings">${copy.findings}</a><a href="#impacts">${copy.impacts}</a><a href="#regression">${copy.regression}</a></nav>
<h2>${isCompare ? copy.comparison.mode : copy.target[review.target]} · ${text(review.label)}</h2>
${
  comparison === undefined
    ? `<p><code>${text(review.from)} → ${review.to === null ? copy.worktreeVersion : text(review.to)}</code></p>`
    : `<p>${copy.comparison.from} <code>${text(review.from)}</code> · ${copy.comparison.match[comparison.fromMatch]}</p>
<p>${copy.comparison.to} <code>${review.to === null ? copy.worktreeVersion : text(review.to)}</code> · ${copy.comparison.match[comparison.toMatch]}</p>`
}
${completionTime(review.finishedAt)}
${comparison === undefined ? `<p>${copy.match[review.designMatch]}${review.designSnapshotSha === null ? '' : ` · <code>${text(review.designSnapshotSha)}</code>`}</p>` : ''}
${reportStatistics(review)}
${review.summary === null ? '' : `<p class="body-text">${text(review.summary)}</p>`}
</header>
<main>
${comparison === undefined ? '' : comparisonSection(comparison, text)}
${isCompare ? comparisonFiles(review.files, text) : ''}
${findingsSection(review, text)}
${impactsSection(review, text)}
<section id="regression"><h2>${copy.regression}</h2>${review.regressionChecks.length === 0 ? `<p>${copy.noChecks}</p>` : checks(review.regressionChecks, text)}</section>
</main>
<script>${THEME_AND_FILTERS}</script>
</body>
</html>
`;
}

async function requireWritableReport(
  target: string,
  reviewId: string,
  overwrite: boolean,
  stageName?: string,
): Promise<void> {
  const current = await exportPathMetadata(target);
  if (current === undefined) return;
  if (!current.isDirectory()) invalidExportTarget('The export target must be a directory');

  const entries = (await readdir(target, { withFileTypes: true })).filter(({ name }) => name !== stageName);
  const report = entries.find(({ name }) => name === REPORT_NAME);
  if (report !== undefined && !report.isFile()) {
    throw new AppError(ErrorCode.DesignExportDirNotEmpty, 'The report path must be a regular file');
  }
  if (overwrite || entries.length === 0) return;
  if (entries.length === 1 && report !== undefined) {
    const marker = Buffer.from(markerFor(reviewId));
    const currentMarker = Buffer.alloc(marker.length);
    const handle = await open(join(target, REPORT_NAME), 'r');
    try {
      const { bytesRead } = await handle.read(currentMarker);
      if (bytesRead === marker.length && currentMarker.equals(marker)) return;
    } finally {
      await handle.close();
    }
  }
  throw new AppError(ErrorCode.DesignExportDirNotEmpty, 'The export directory contains files outside this report');
}

/** 先构建临时文件，再以同卷 rename 发布。显式覆盖时也只替换报告文件。 */
export async function exportGitReviewReport(
  review: GitReviewDTO,
  project: { name: string; repoPath: string },
  targetDir: string,
  overwrite = false,
): Promise<{ path: string }> {
  const target = await canonicalExportTarget(targetDir, project.repoPath);
  const privatePaths = [...new Set([project.repoPath, targetDir, target].filter(isAbsolute))]
    .flatMap((path) => [path, path.replaceAll('\\', '/')])
    .sort((left, right) => right.length - left.length);
  const html = renderReport(review, project.name, privatePaths);
  const path = join(target, REPORT_NAME);
  return withExportTargetLock(target, async () => {
    await requireWritableReport(target, review.id, overwrite);
    await mkdir(target, { recursive: true });
    const stage = await mkdtemp(join(target, '.aw-git-review-'));
    try {
      const stagedReport = join(stage, REPORT_NAME);
      await writeFile(stagedReport, html, { flag: 'wx' });
      await requireWritableReport(target, review.id, overwrite, basename(stage));
      await rename(stagedReport, path);
      return { path };
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  });
}
