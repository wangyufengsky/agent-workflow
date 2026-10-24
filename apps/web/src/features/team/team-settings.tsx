import {
  TEAM_DEFAULT_EXCLUDE_GLOBS,
  TEAM_DEFAULT_TEST_GLOBS,
  TEAM_HUGE_COMMIT_LINES,
  type TeamSettingsDTO,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Drawer } from '../../components/drawer.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { COMMON_COPY } from '../../copy/common.ts';
import { TEAM_COPY as C } from '../../copy/team.ts';
import { teamSettingsQuery, useUpdateTeamSettings } from './team.queries.ts';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');

/** How lines are counted for the project (33 §2.4, §5.4): pro mode only. */
export function TeamSettingsDrawer({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useQuery({ ...teamSettingsQuery(projectId), enabled: open });
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={C.settingsTitle}>
      {settings.isPending && <p className="hint">{COMMON_COPY.loading}</p>}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />}
      {settings.data !== undefined && (
        <SettingsForm
          key={JSON.stringify(settings.data)}
          projectId={projectId}
          settings={settings.data}
          onDone={() => onOpenChange(false)}
        />
      )}
    </Drawer>
  );
}

function SettingsForm({
  projectId,
  settings,
  onDone,
}: {
  projectId: string;
  settings: TeamSettingsDTO;
  onDone: () => void;
}) {
  const [exclude, setExclude] = useState(settings.excludeGlobs.join('\n'));
  const [tests, setTests] = useState(settings.testGlobs.join('\n'));
  const [huge, setHuge] = useState(String(settings.hugeCommitLines));
  const update = useUpdateTeamSettings(projectId);
  const hugeLines = Number(huge);
  const valid = Number.isInteger(hugeLines) && hugeLines >= 1;
  const save = () =>
    update.mutate(
      { excludeGlobs: lines(exclude), testGlobs: lines(tests), hugeCommitLines: hugeLines },
      {
        onSuccess: () => {
          toast(C.settingsSaved);
          onDone();
        },
      },
    );
  return (
    <div className="col" data-testid="team-settings">
      <p className="hint">{C.settingsLede}</p>
      <label className="field">
        <span className="label">{C.excludeGlobs}</span>
        <textarea className="textarea mono" rows={8} value={exclude} onChange={(e) => setExclude(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">{C.testGlobs}</span>
        <textarea className="textarea mono" rows={6} value={tests} onChange={(e) => setTests(e.target.value)} />
      </label>
      <label className="field">
        <span className="label">{C.hugeCommitLines}</span>
        <input
          className="input"
          type="number"
          min={1}
          value={huge}
          onChange={(e) => setHuge(e.target.value)}
          aria-invalid={!valid}
        />
        <span className="hint">{C.hugeCommitLinesHint}</span>
      </label>
      {update.isError && <ErrorState error={update.error} />}
      <div className="row">
        <Button
          variant="ghost"
          onClick={() => {
            setExclude(TEAM_DEFAULT_EXCLUDE_GLOBS.join('\n'));
            setTests(TEAM_DEFAULT_TEST_GLOBS.join('\n'));
            setHuge(String(TEAM_HUGE_COMMIT_LINES));
          }}
        >
          {C.resetDefaults}
        </Button>
        <span className="grow" />
        <Button variant="primary" disabled={!valid} pending={update.isPending} onClick={save}>
          {C.save}
        </Button>
      </div>
    </div>
  );
}
