import type { ProjectDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { Icon } from '../../components/icon.tsx';
import { PathText } from '../../components/path-text.tsx';
import { COMMON_COPY, formatDateTime } from '../../copy/common.ts';
import { GIT_COPY as C } from '../../copy/git.ts';
import { projectsQuery } from '../projects/projects.queries.ts';
import styles from './git.module.css';
import { gitLastCommitQuery, gitReviewQuery, gitReviewsQuery, gitStatusQuery } from './git.queries.ts';
import { Avatar, ReviewBadge } from './git-parts.tsx';

function ProjectCard({ project }: { project: ProjectDTO }) {
  const status = useQuery(gitStatusQuery(project.id));
  const branch = status.data?.branch ?? null;
  const last = useQuery({ ...gitLastCommitQuery(project.id, branch ?? 'HEAD'), enabled: status.isSuccess });
  const review = useQuery(gitReviewsQuery(project.id)).data?.[0];
  const head = (
    <div className={styles.cardHead}>
      <span className="tile">
        <Icon name={status.isError ? 'alert' : 'git'} />
      </span>
      <div className={styles.cardTitle}>
        <span className={styles.name}>{project.name}</span>
        <PathText path={project.repoPath} className="hint" />
      </div>
    </div>
  );
  if (status.isError) {
    return (
      <article className={`card ${styles.card}`}>
        {head}
        <div className="banner warn">
          <Icon name="alert" />
          <div>{C.repoUnreadable}</div>
        </div>
        <div className={styles.cardFoot}>
          <span className={styles.spacer} />
          <Link className="btn secondary sm" to={ROUTES.project} params={{ projectId: project.id }}>
            {C.toProject}
          </Link>
        </div>
      </article>
    );
  }
  const s = status.data;
  return (
    <article className={`card ${styles.card}`} data-testid="git-project-card">
      {head}
      {s === undefined ? (
        <p className="hint">{COMMON_COPY.loading}</p>
      ) : (
        <div className={styles.figures}>
          <div>
            <small>{C.currentBranch}</small>
            <span className="mono">
              <Icon name="branch" size="sm" />
              {s.branch ?? C.detached}
            </span>
          </div>
          <div>
            <small>{C.withRemote}</small>
            <span>
              {s.upstream === null ? C.noUpstream : s.ahead + s.behind === 0 ? C.inSync : `↑${s.ahead} ↓${s.behind}`}
            </span>
          </div>
          <div>
            <small>{C.uncommitted}</small>
            <span className={s.clean ? undefined : 'tone-warn'}>{s.clean ? C.none : C.count(s.files.length)}</span>
          </div>
        </div>
      )}
      {last.data !== undefined && last.data !== null && (
        <div className={styles.lastCommit}>
          <Avatar name={last.data.authorName} />
          <span className={styles.text}>{last.data.subject}</span>
          <span className={styles.when}>
            {last.data.authorName} · {formatDateTime(last.data.authoredAt)}
          </span>
        </div>
      )}
      <div className={styles.cardFoot}>
        {review !== undefined && <ReviewBadge review={review} />}
        <span className="chip">{project.hosting === null ? C.hostingNone : project.hosting.provider}</span>
        <span className={styles.spacer} />
        <Link className="btn secondary sm" to={ROUTES.gitProject} params={{ projectId: project.id }}>
          {C.enter}
          <Icon name="chevRight" size="sm" />
        </Link>
      </div>
    </article>
  );
}

/** Git workbench entry (27 §6.1, pro): a card per project with its repository's state. */
export function GitConsolePage() {
  const projects = useQuery(projectsQuery);
  return (
    <div className={styles.overview}>
      <h1 className="title">{C.title}</h1>
      <p className="lede">{C.lede}</p>
      {projects.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {projects.isError && <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />}
      <div className={styles.cards}>
        {projects.data?.map((p) => (
          <ProjectCard key={p.id} project={p} />
        ))}
      </div>
    </div>
  );
}

/**
 * `/git/reviews/:reviewId`: a review opened from elsewhere (the assistant's card, D66) is shown in its project's
 * workbench.
 */
export function GitReviewRedirect({ reviewId }: { reviewId: string }) {
  const review = useQuery(gitReviewQuery(reviewId));
  const navigate = useNavigate();
  const projectId = review.data?.projectId;
  useEffect(() => {
    if (projectId === undefined) return;
    void navigate({
      to: ROUTES.gitProject,
      params: { projectId },
      search: { view: 'review', review: reviewId },
      replace: true,
    });
  }, [navigate, projectId, reviewId]);
  if (review.isError) {
    return (
      <div className="page">
        <ErrorState error={review.error} />
      </div>
    );
  }
  return <p className="page hint">{COMMON_COPY.loading}</p>;
}
