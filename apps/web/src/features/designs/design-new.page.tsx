import { DesignDepth, DesignLayoutStyle, THEME_IDS, type ThemeId, themeIdSchema } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ROUTE_IDS, ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { DESIGNS_COPY as C, DESIGN_DEPTH_COPY, DESIGN_LAYOUT_LABEL } from '../../copy/designs.ts';
import { THEME_LABEL } from '../../copy/themes.ts';
import { resolveTheme } from '../../theme/apply-theme.ts';
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
  const [layoutStyle, setLayout] = useState<DesignLayoutStyle>(DesignLayoutStyle.Doc);
  const [theme, setTheme] = useState<ThemeId>(() =>
    resolveTheme(settings['ui.theme'], window.matchMedia('(prefers-color-scheme: dark)').matches),
  );
  const [exclude, setExclude] = useState('');
  const [reviewOverride, setReviewOverride] = useState<boolean>();
  const [model, setModel] = useState(settings['ai.defaultModel']);
  const create = useCreateDesign();

  const validProject = projects.data?.some((project) => project.id === projectId) === true;
  const templates = useQuery(designTemplatesQuery(validProject ? projectId : undefined));
  const selected =
    templates.data?.items.find((t) => t.key === explicitTemplate) ??
    templates.data?.items.find((t) => t.key === templates.data.suggested?.recommendedTemplateKey);
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
        theme,
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
      <form className={`card pad col ${styles.creator}`} aria-label={C.newDesign} onSubmit={submit}>
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
        {templates.data?.suggested && (
          <span className="hint">{C.detected(templates.data.suggested.techStack.join(' · ') || C.genericStack)}</span>
        )}
        {templates.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
        {templates.isError && <ErrorState error={templates.error} onRetry={() => void templates.refetch()} />}
        <fieldset className={styles.fieldset}>
          <legend className="label">{C.template}</legend>
          <div className={styles.choices}>
            {templates.data?.items.map((template) => (
              <label key={template.key} className={styles.choice}>
                <input
                  type="radio"
                  name="analysis-template"
                  checked={selected?.key === template.key}
                  onChange={() => setExplicitTemplate(template.key)}
                />
                <span>
                  {template.name}
                  {template.key === templates.data?.suggested?.recommendedTemplateKey && (
                    <span className="hint"> · {C.autoTemplate}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {selected !== undefined && (
            <div className={styles.templatePreview}>
              <strong>{C.chapterBlueprint}</strong>
              <div>{selected.defaultSections.map((section) => section.title).join(' → ')}</div>
            </div>
          )}
          <Link
            className="btn sm"
            to={ROUTES.designs}
            search={{ tab: 'templates', projectId: validProject ? projectId : undefined }}
          >
            {C.goToLibrary}
          </Link>
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className="label">{C.depth}</legend>
          <div className={styles.choices}>
            {Object.values(DesignDepth).map((value) => (
              <label key={value} className={styles.choice}>
                <input type="radio" name="depth" checked={depth === value} onChange={() => setDepth(value)} />
                <span className="col">
                  <strong>{DESIGN_DEPTH_COPY[value].label}</strong>
                  <span className="hint">{DESIGN_DEPTH_COPY[value].hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row wrap">
          <fieldset className={`grow ${styles.fieldset}`}>
            <legend className="label">{C.layout}</legend>
            <div className="row wrap">
              {Object.values(DesignLayoutStyle).map((value) => (
                <label key={value} className="check">
                  <input type="radio" name="layout" checked={layoutStyle === value} onChange={() => setLayout(value)} />
                  {DESIGN_LAYOUT_LABEL[value]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="field">
            <span className="label">{C.theme}</span>
            <select
              className="select"
              value={theme}
              onChange={(event) => setTheme(themeIdSchema.parse(event.target.value))}
            >
              {THEME_IDS.map((id) => (
                <option key={id} value={id}>
                  {THEME_LABEL[id]}
                </option>
              ))}
            </select>
          </label>
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
