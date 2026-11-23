import { type FunctionalTestScope, getProjectModulesOp, type ProjectDTO } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { ErrorState } from '../../components/error-state.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { FUNCTIONAL_TEST_COPY as C } from '../../copy/functional-testing.ts';
import { PROJECT_MODULES_COPY as M } from '../../copy/project-modules.ts';

type Selection = Pick<FunctionalTestScope, 'moduleSelection' | 'compoundSelection'>;

function selectionKey(selection: Selection) {
  const { moduleSelection: module, compoundSelection: compound } = selection;
  return compound === undefined
    ? module === undefined
      ? ''
      : JSON.stringify(['module', module.moduleId, module.configurationId])
    : JSON.stringify(['compound', compound.compoundId]);
}

export function useFunctionalTestSource({
  project,
  prefill,
  enabled,
}: {
  project: ProjectDTO | undefined;
  prefill: Selection;
  enabled: boolean;
}) {
  const [selection, setSelection] = useState<Selection>(prefill);
  const catalog = useQuery({
    queryKey: ['project-modules', project?.id, project?.defaultBranch],
    queryFn: () => callOperation(getProjectModulesOp, { id: project?.id ?? '' }),
    enabled: enabled && project !== undefined,
  });
  const moduleSelection = selection.moduleSelection;
  const compoundSelection = selection.compoundSelection;
  const compounds = catalog.data?.compounds ?? [];
  const compound = compounds.find(
    ({ id, fingerprint }) => id === compoundSelection?.compoundId && fingerprint === compoundSelection.fingerprint,
  );
  const modules = catalog.data?.modules ?? [];
  const module = modules.find(({ id }) => id === moduleSelection?.moduleId);
  const configId =
    moduleSelection?.configurationId ?? (module === undefined ? undefined : catalog.data?.defaults[module.id]);
  const config = module?.configurations.find(
    ({ id, fingerprint, launch, review }) =>
      id === configId &&
      launch !== null &&
      review.length === 0 &&
      (moduleSelection?.fingerprint === undefined || moduleSelection.fingerprint === fingerprint),
  );
  const plan = compound?.review.length === 0 ? compound.plan : undefined;
  const services = plan?.services ?? [];
  const targetId = compoundSelection?.targetServiceId ?? plan?.targetServiceId;
  const target = services.find(({ id }) => id === targetId);
  const moduleOptions = modules.flatMap((item) =>
    item.kind === 'service'
      ? item.configurations
          .filter(({ launch, review }) => launch !== null && review.length === 0)
          .map((configuration) => ({
            label: `${item.name} · ${configuration.name}`,
            selection: {
              moduleSelection: {
                moduleId: item.id,
                configurationId: configuration.id,
                fingerprint: configuration.fingerprint,
              },
            },
          }))
      : [],
  );
  const compoundOptions = compounds
    .filter(({ plan, review }) => plan !== null && review.length === 0)
    .map((item) => ({
      label: item.name,
      selection: { compoundSelection: { compoundId: item.id, fingerprint: item.fingerprint } },
    }));
  const bound = moduleSelection !== undefined || compoundSelection !== undefined;
  const valid =
    !bound || (!catalog.isError && (compoundSelection !== undefined ? target !== undefined : config !== undefined));
  function choose(key: string) {
    const option = [...moduleOptions, ...compoundOptions].find((item) => selectionKey(item.selection) === key);
    setSelection(option?.selection ?? {});
  }
  function chooseTarget(targetServiceId: string) {
    if (compoundSelection !== undefined) setSelection({ compoundSelection: { ...compoundSelection, targetServiceId } });
  }
  return {
    selection,
    catalog,
    moduleOptions,
    compoundOptions,
    bound,
    valid,
    choose,
    chooseTarget,
    services,
    target,
    config,
    reset: () => setSelection({}),
  };
}

export function FunctionalTestSource({ source }: { source: ReturnType<typeof useFunctionalTestSource> }) {
  const { catalog, moduleOptions, compoundOptions, bound, valid, selection, target, services, choose, chooseTarget } =
    source;
  if (!bound && !catalog.isError && moduleOptions.length === 0 && compoundOptions.length === 0) return null;
  const selected = valid
    ? selectionKey(
        source.config !== undefined && selection.moduleSelection !== undefined
          ? { moduleSelection: { ...selection.moduleSelection, configurationId: source.config.id } }
          : selection,
      )
    : 'unavailable';
  return (
    <div className="col">
      <label className="col">
        {C.executionSource}
        <select className="input" value={selected} onChange={(event) => choose(event.target.value)}>
          <option value="">{C.manualSource}</option>
          {!valid && (
            <option value="unavailable" disabled>
              {C.selectedSource}
            </option>
          )}
          {moduleOptions.length > 0 && (
            <optgroup label={M.list}>
              {moduleOptions.map(({ label, selection }) => (
                <option key={selectionKey(selection)} value={selectionKey(selection)}>
                  {label}
                </option>
              ))}
            </optgroup>
          )}
          {compoundOptions.length > 0 && (
            <optgroup label={M.compounds}>
              {compoundOptions.map(({ label, selection }) => (
                <option key={selectionKey(selection)} value={selectionKey(selection)}>
                  {label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {target !== undefined && (
        <label className="col">
          {M.targetService}
          <select className="input" value={target.id} onChange={(event) => chooseTarget(event.target.value)}>
            {services.map(({ id, name, moduleId }) => (
              <option key={id} value={id}>
                {name ?? moduleId ?? id}
              </option>
            ))}
          </select>
        </label>
      )}
      {bound && !valid && (
        <p className="hint" role="status">
          {catalog.isPending ? COMMON_COPY.loading : C.moduleUnavailable}
        </p>
      )}
      {catalog.isError && <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />}
    </div>
  );
}
