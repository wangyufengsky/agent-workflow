import {
  TEAM_WORK_TYPES,
  type TeamDirectoryDTO,
  type TeamMediansDTO,
  type TeamMemberDTO,
  type TeamMetricsDTO,
  type TeamSummaryDTO,
} from '@aw/shared';
import { type ReactNode, useState } from 'react';
import { TEAM_COPY as C, formatCount, formatDecimal, formatRate, WORK_TYPE_LABEL } from '../../copy/team.ts';
import { SERIES_TONES, type SeriesTone } from '../insights/bar-chart.tsx';
import chart from '../insights/insights.module.css';
import styles from './team.module.css';

/** The figures compared across members and periods; each is its own column and chart (D128). */
export const METRICS = [
  { key: 'commits', label: C.metric.commits, get: (m: TeamMetricsDTO) => m.commits, format: formatCount },
  { key: 'activeDays', label: C.metric.activeDays, get: (m: TeamMetricsDTO) => m.activeDays, format: formatCount },
  { key: 'added', label: C.metric.added, get: (m: TeamMetricsDTO) => m.added, format: formatCount },
  { key: 'deleted', label: C.metric.deleted, get: (m: TeamMetricsDTO) => m.deleted, format: formatCount },
  { key: 'files', label: C.metric.files, get: (m: TeamMetricsDTO) => m.files, format: formatCount },
  {
    key: 'commitLinesMedian',
    label: C.metric.commitLinesMedian,
    get: (m: TeamMetricsDTO) => m.commitLinesMedian,
    format: formatDecimal,
  },
  { key: 'testRate', label: C.metric.testRate, get: (m: TeamMetricsDTO) => m.testRate, format: formatRate },
  { key: 'reverted', label: C.metric.reverted, get: (m: TeamMetricsDTO) => m.reverted, format: formatCount },
  { key: 'aiCommits', label: C.metric.aiCommits, get: (m: TeamMetricsDTO) => m.aiCommits, format: formatCount },
] as const satisfies readonly {
  key: keyof TeamMediansDTO;
  label: string;
  get: (m: TeamMetricsDTO) => number | null;
  format: (v: number) => string;
}[];
export type MetricKey = (typeof METRICS)[number]['key'];
export const metricOf = (key: MetricKey) => METRICS.find((m) => m.key === key) ?? METRICS[0];

/** The member's colour in the charts, by position in the name order; the rest share a neutral one. */
export const toneOf = (index: number): SeriesTone => SERIES_TONES[index] ?? 'sRest';

/** `↑ 12%` against the period before; nothing when there is nothing to compare with. */
export function Delta({ current, previous }: { current: number | null; previous: number | null }) {
  if (current === null || previous === null || previous === 0) return null;
  const change = (current - previous) / previous;
  const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '';
  return (
    <span className={styles.delta} title={C.vsPrevious}>
      {arrow} {formatRate(Math.abs(change))}
    </span>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  delta,
  sub,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  delta?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className={`card ${styles.metric}`} title={hint}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>
        {value}
        {delta}
      </span>
      {sub !== undefined && <span className={styles.metricSub}>{sub}</span>}
    </div>
  );
}

/** Lines added and deleted as `+a −d`. */
export const Lines = ({ added, deleted }: { added: number | null; deleted: number | null }) => (
  <span className={styles.lines}>
    <span className={styles.added}>+{formatDecimal(added)}</span>
    <span className={styles.deleted}>−{formatDecimal(deleted)}</span>
  </span>
);

type SortKey = 'name' | 'lines' | Exclude<MetricKey, 'added' | 'deleted'>;
const TABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'commits', label: C.metric.commits },
  { key: 'activeDays', label: C.metric.activeDays },
  { key: 'lines', label: C.metric.lines },
  { key: 'files', label: C.metric.files },
  { key: 'commitLinesMedian', label: C.metric.commitLinesMedian },
  { key: 'testRate', label: C.metric.testRate },
  { key: 'reverted', label: C.metric.reverted },
  { key: 'aiCommits', label: C.metric.aiCommits },
];

const sortValue = (m: TeamMetricsDTO, key: Exclude<SortKey, 'name'>): number =>
  key === 'lines' ? m.added + m.deleted : (metricOf(key).get(m) ?? Number.NEGATIVE_INFINITY);

/** One row per member, by name unless the user sorts by a column (33 §5.2 ⑤). */
export function MemberTable({
  members,
  medians,
  analyses,
  onOpen,
}: {
  members: readonly TeamMemberDTO[];
  medians: TeamMediansDTO;
  /** Each member's latest AI analysis of the same range (33 §6.5). */
  analyses: TeamSummaryDTO['analyses'];
  onOpen: (member: TeamMemberDTO) => void;
}) {
  const analysisOf = new Map(analyses.map((a) => [a.member, a]));
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'name', desc: false });
  const sorted = [...members].sort((x, y) => {
    const order =
      sort.key === 'name'
        ? x.name.localeCompare(y.name)
        : sortValue(x.metrics, sort.key) - sortValue(y.metrics, sort.key);
    return sort.desc ? -order : order;
  });
  const most = Math.max(1, ...members.map((m) => m.metrics.added + m.metrics.deleted));
  const header = (key: SortKey, label: string) => (
    <th key={key} className={key === 'name' ? undefined : chart.num} aria-sort={sortState(sort, key)}>
      <button
        type="button"
        className={styles.sort}
        onClick={() => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'name' }))}
      >
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.desc ? ' ↓' : ' ↑'}</span>}
      </button>
    </th>
  );
  return (
    <table className={chart.table} data-testid="team-members">
      <thead>
        <tr>
          {header('name', C.member)}
          {TABLE_COLUMNS.map((c) => header(c.key, c.label))}
          <th className={chart.num} title={C.qualityHint}>
            {C.qualityColumn}
          </th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((member) => (
          <tr key={member.key}>
            <td>
              <button type="button" className={chart.link} onClick={() => onOpen(member)}>
                <span className={styles.avatar} aria-hidden="true">
                  {member.name.slice(0, 1).toUpperCase()}
                </span>
                <span data-testid="member-name">{member.name}</span>
              </button>
            </td>
            <td className={chart.num}>{formatCount(member.metrics.commits)}</td>
            <td className={chart.num}>{formatCount(member.metrics.activeDays)}</td>
            <td className={chart.num}>
              <span className={chart.barCell}>
                <span className={chart.barTrack} aria-hidden="true">
                  <i style={{ width: `${((member.metrics.added + member.metrics.deleted) / most) * 100}%` }} />
                </span>
                <Lines added={member.metrics.added} deleted={member.metrics.deleted} />
              </span>
            </td>
            <td className={chart.num}>{formatCount(member.metrics.files)}</td>
            <td className={chart.num}>{formatDecimal(member.metrics.commitLinesMedian)}</td>
            <td className={chart.num}>{formatRate(member.metrics.testRate)}</td>
            <td className={chart.num}>{formatCount(member.metrics.reverted)}</td>
            <td className={chart.num}>{formatCount(member.metrics.aiCommits)}</td>
            <td className={chart.num}>
              <AnalysisCell analysis={analysisOf.get(member.key)} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={styles.medianRow}>
          <td>{C.medianRow}</td>
          <td className={chart.num}>{formatDecimal(medians.commits)}</td>
          <td className={chart.num}>{formatDecimal(medians.activeDays)}</td>
          <td className={chart.num}>
            <Lines added={medians.added} deleted={medians.deleted} />
          </td>
          <td className={chart.num}>{formatDecimal(medians.files)}</td>
          <td className={chart.num}>{formatDecimal(medians.commitLinesMedian)}</td>
          <td className={chart.num}>{formatRate(medians.testRate)}</td>
          <td className={chart.num}>{formatDecimal(medians.reverted)}</td>
          <td className={chart.num}>{formatDecimal(medians.aiCommits)}</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

/** Blocker and major findings per thousand reviewed lines, or where the analysis stands. */
function AnalysisCell({ analysis }: { analysis: TeamSummaryDTO['analyses'][number] | undefined }) {
  if (analysis === undefined) return <span className="hint">—</span>;
  const q = analysis.quality;
  if (q === null) return <span className="hint">{C.analysisStatus[analysis.status]}</span>;
  return (
    <span className={styles.quality} title={C.qualityCell(q.blocker, q.major, q.minor)}>
      {q.perKloc === null ? '—' : formatDecimal(q.perKloc.blocker + q.perKloc.major)}
    </span>
  );
}

function sortState(sort: { key: SortKey; desc: boolean }, key: SortKey): 'ascending' | 'descending' | undefined {
  if (sort.key !== key) return undefined;
  return sort.desc ? 'descending' : 'ascending';
}

/** One horizontal bar per member for the chosen metric, with the team median as a line (33 §5.2 ⑥). */
export function CompareBars({
  members,
  medians,
  metric,
}: {
  members: readonly TeamMemberDTO[];
  medians: TeamMediansDTO;
  metric: MetricKey;
}) {
  const m = metricOf(metric);
  const values = members.map((member) => ({ member, value: m.get(member.metrics) }));
  const most = Math.max(0, ...values.map((v) => v.value ?? 0), medians[metric] ?? 0);
  const width = (v: number) => (most === 0 ? 0 : (v / most) * 100);
  const median = medians[metric];
  return (
    <figure className={styles.compare} aria-label={C.compareTitle} data-testid="team-compare">
      {median !== null && <figcaption className="hint">{C.medianLine(m.format(median))}</figcaption>}
      <ul>
        {values.map(({ member, value }, i) => (
          <li key={member.key}>
            <span className={styles.compareName}>{member.name}</span>
            <span className={styles.compareTrack}>
              <i className={chart[toneOf(i)]} style={{ width: `${width(value ?? 0)}%` }} />
              {median !== null && <b className={styles.medianMark} style={{ left: `${width(median)}%` }} />}
            </span>
            <span className={styles.compareValue}>{value === null ? '—' : m.format(value)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A proportion bar: each part's share of the whole, with its name on hover. */
export function ShareBar({ parts }: { parts: { key: string; name: string; value: number; tone: SeriesTone }[] }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <span className={styles.share} aria-hidden="true">
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <i
            key={p.key}
            className={chart[p.tone]}
            style={{ width: `${(p.value / total) * 100}%` }}
            title={`${p.name} ${formatCount(p.value)}`}
          />
        ))}
    </span>
  );
}

/** Directories by changed lines, each with the members' shares (33 §5.2 ⑦). */
export function DirectoryShares({
  directories,
  members,
}: {
  directories: readonly TeamDirectoryDTO[];
  members: readonly TeamMemberDTO[];
}) {
  const index = new Map(members.map((m, i) => [m.key, i]));
  const name = new Map(members.map((m) => [m.key, m.name]));
  return (
    <ul className={styles.directories} data-testid="team-directories">
      {directories.map((d) => (
        <li key={d.path}>
          <span className={`mono ${styles.dirPath}`}>{d.path === '' ? C.rootDirectory : d.path}</span>
          <ShareBar
            parts={d.members.map((m) => ({
              key: m.key,
              name: name.get(m.key) ?? m.key,
              value: m.lines,
              tone: toneOf(index.get(m.key) ?? Number.POSITIVE_INFINITY),
            }))}
          />
          <span className={styles.dirLines}>{formatCount(d.lines)}</span>
          <span className="sr">
            {d.members.map((m) => `${name.get(m.key) ?? m.key} ${formatCount(m.lines)}`).join('，')}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Commits by kind of work as a proportion bar and the numbers (33 §3.3). */
export function WorkMix({ metrics }: { metrics: TeamMetricsDTO }) {
  const parts = TEAM_WORK_TYPES.map((type, i) => ({
    key: type,
    name: WORK_TYPE_LABEL[type],
    value: metrics.workMix[type],
    tone: toneOf(i),
  }));
  return (
    <div className="col" data-testid="team-work-mix">
      <ShareBar parts={parts} />
      <ul className={styles.legendList}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <li key={p.key}>
              <i className={chart[p.tone]} aria-hidden="true" />
              {p.name} {formatCount(p.value)}
            </li>
          ))}
      </ul>
    </div>
  );
}
