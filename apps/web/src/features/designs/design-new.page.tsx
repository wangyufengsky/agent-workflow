import { DesignDepth, DesignLayoutStyle, GENERAL_DESIGN_TEMPLATE_KEY } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DESIGNS_COPY as C, DESIGN_DEPTH_COPY, DESIGN_LAYOUT_LABEL } from '../../copy/designs.ts';
import { ModelPicker } from '../knowledge/model-picker.tsx';
import { projectsQuery } from '../projects/projects.queries.ts';
import { useSettings } from '../settings/settings.queries.ts';
import styles from './designs.module.css';
import { designTemplatesQuery, useCreateDesign } from './designs.queries.ts';

const route = getRouteApi(ROUTE_IDS.designNew);

function NewDesignForm({ initialProject, initialTemplate }: { initialProject: string; initialTemplate: string }) {
  const navigate = useNavigate();
  const settings = useSettings();
  const projects = useQuery(projectsQuery);
  const [projectId, setProject] = useState(initialProject);
  const [explicitTemplate, setExplicitTemplate] = useState(initialTemplate);
  const [depth, setDepth] = useState<DesignDepth>(DesignDepth.Standard);
  const [layoutStyle, setLayout] = useState<DesignLayoutStyle>(DesignLayoutStyle.Arch);
  const [exclude, setExclude] = useState('');
  const [reviewOverride, setReviewOverride] = useState<boolean>();
  const [model, setModel] = useState(settings['ai.defaultModel']);
  const create = useCreateDesign();

  const validProject = projects.data?.some((project) => project.id === projectId) === true;
  const templates = useQuery(designTemplatesQuery());
  const projectPreview = useQuery({ ...designTemplatesQuery(projectId), enabled: validProject });
  const suggested = validProject ? projectPreview.data?.suggested : null;
  const selected =
    templates.data?.items.find((t) => t.key === explicitTemplate) ??
    templates.data?.items.find((t) => t.key === suggested?.recommendedTemplateKey) ??
    templates.data?.items.find((t) => t.key === GENERAL_DESIGN_TEMPLATE_KEY);
  const review = reviewOverride ?? depth === DesignDepth.Deep;
  const canScan = validProject && selected !== undefined && !templates.isPending;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canScan || create.isPending) return;
    create.mutate(
      {
        projectId,
        templateKey: selected.key,
        depth,
        layoutStyle,
        aiReviewEnabled: review,
        excludePatterns: exclude
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      },
      {
        onSuccess: (design) =>
          void navigate({
            to: ROUTES.designWorkbench,
            params: { designId: design.id },
            search: { model: model ?? '' },
          }),
      },
    );
  }
  return (
    <div className="page">
      <header className="page-head">
        <div className="grow">
          <h1 className="title">{C.newDesign}</h1>
          <p className="lede">{C.newLede}</p>
        </div>
        <Link className="btn" to={ROUTES.designs} search={{ projectId: validProject ? projectId : undefined }}>
          {C.back}
        </Link>
      </header>
      <form className={styles.creator} aria-label={C.newDesign} onSubmit={submit}>
        {projects.isError && <ErrorState error={projects.error} onRetry={() => void projects.refetch()} />}
        {projects.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
        <label className="field">
          <span className="label">{C.project}</span>
          <select
            className="select"
            required
            value={validProject ? projectId : ''}
            onChange={(event) => setProject(event.target.value)}
          >
            <option value="">{C.chooseProject}</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <section className={styles.setupSection}>
          <div className="row wrap">
            <h2 className={`grow ${styles.setupTitle}`}>{C.template}</h2>
            <Link
              className="btn ghost sm"
              to={ROUTES.designs}
              search={{ tab: 'templates', projectId: validProject ? projectId : undefined }}
            >
              {C.goToLibrary}
            </Link>
          </div>
          <p className={`hint ${styles.recommendation}`} aria-live="polite">
            {suggested
              ? C.detected(suggested.techStack.join(' · ') || C.genericStack)
              : validProject && projectPreview.isPending
                ? C.detectingStack
                : C.chooseProjectForStack}
          </p>
          {projectPreview.isError && validProject && (
            <ErrorState error={projectPreview.error} onRetry={() => void projectPreview.refetch()} />
          )}
          {templates.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
          {templates.isError && <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />}
          <fieldset className={`${styles.fieldset} ${styles.templatePicker}`} aria-label={C.template}>
            <div className={styles.templateChoices}>
              {templates.data?.items.map((template) => (
                <label key={template.key} className={styles.choice}>
                  <input
                    type="radio"
                    name="analysis-template"
                    checked={selected?.key === template.key}
                    onChange={() => setExplicitTemplate(template.key)}
                  />
                  <span className={styles.choiceText}>
                    <strong>{template.name}</strong>
                    <span className="hint">{template.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
        <div className={styles.setupPair}>
          <fieldset className={styles.fieldset}>
            <legend className="label">{C.depth}</legend>
            <div className={styles.choices}>
              {Object.values(DesignDepth).map((value) => (
                <label key={value} className={styles.choice}>
                  <input type="radio" name="depth" checked={depth === value} onChange={() => setDepth(value)} />
                  <span className={styles.choiceText}>
                    <strong>{DESIGN_DEPTH_COPY[value].label}</strong>
                    <span className="hint">{DESIGN_DEPTH_COPY[value].hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend className="label">{C.layout}</legend>
            <div className={styles.layoutChoices}>
              {Object.values(DesignLayoutStyle).map((value) => (
                <label key={value} className={styles.choice}>
                  <input type="radio" name="layout" checked={layoutStyle === value} onChange={() => setLayout(value)} />
                  <strong>{DESIGN_LAYOUT_LABEL[value]}</strong>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <label className="field">
          <span className="label">{C.exclusions}</span>
          <span className="hint">{C.exclusionHint}</span>
          <input
            className="input mono"
            placeholder={C.exclusionPlaceholder}
            value={exclude}
            onChange={(event) => setExclude(event.target.value)}
          />
        </label>
        <label className="check">
          <input type="checkbox" checked={review} onChange={(event) => setReviewOverride(event.target.checked)} />
          {C.autoReview}
        </label>
        {create.isError && <ErrorState error={create.error} />}
        <div className={`row wrap ${styles.formFooter}`}>
          <span className="hint">{C.model}</span>
          <ModelPicker value={model} projectId={validProject ? projectId : null} onChange={setModel} />
          <span className="grow" />
          <Button type="submit" variant="primary" icon="sparkle" pending={create.isPending} disabled={!canScan}>
            {C.scan}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function DesignNewPage() {
  const search = route.useSearch();
  return (
    <NewDesignForm
      key={JSON.stringify(search)}
      initialProject={search.projectId ?? ''}
      initialTemplate={search.template ?? ''}
    />
  );
}
