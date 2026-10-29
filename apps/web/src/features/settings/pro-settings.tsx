import {
  BashPolicy,
  type CommitIdentity,
  commitIdentitySchema,
  LOCAL_MERGE_STRATEGIES,
  type Settings,
} from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { Panel } from '../../components/panel.tsx';
import { DELIVERY_COPY } from '../../copy/delivery.ts';
import { SETTINGS_COPY as C } from '../../copy/settings.ts';
import { environmentQuery } from '../onboarding/environment.queries.ts';
import { usableModels } from '../onboarding/usable-models.ts';
import { NumberSetting, Segmented, TextSetting } from './setting-inputs.tsx';

/**
 * Name and email of task commits (D227), saved when focus leaves both inputs or on Enter: both filled in, or both empty
 * for agent-workflow's identity. Anything in between stays in the inputs, marked, until it is one or the other.
 */
function CommitIdentitySetting({
  value,
  onCommit,
}: {
  value: CommitIdentity | null;
  onCommit: (identity: CommitIdentity | null) => void;
}) {
  const [name, setName] = useState(value?.name ?? '');
  const [email, setEmail] = useState(value?.email ?? '');
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    const empty = name.trim() === '' && email.trim() === '';
    const parsed = commitIdentitySchema.safeParse({ name, email });
    setInvalid(!empty && !parsed.success);
    const next = empty ? null : parsed.data;
    if (next === undefined || (next?.name === value?.name && next?.email === value?.email)) return;
    onCommit(next);
  };
  const enter = (e: KeyboardEvent) => e.key === 'Enter' && commit();
  return (
    <fieldset
      className="field"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) commit();
      }}
    >
      <legend className="label">{C.commitIdentity}</legend>
      <div className="row">
        <input
          className={`input grow${invalid ? ' invalid' : ''}`}
          aria-label={C.commitIdentityName}
          placeholder={C.commitIdentityName}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={enter}
        />
        <input
          className={`input grow${invalid ? ' invalid' : ''}`}
          aria-label={C.commitIdentityEmail}
          placeholder={C.commitIdentityEmail}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={enter}
        />
      </div>
      {invalid && <p className="error-text">{C.commitIdentityInvalid}</p>}
      <p className="hint">{C.commitIdentityHint}</p>
    </fieldset>
  );
}

/** Pro-mode settings (08 §4.3 `SETTING_MODE` = pro, M5-08). Inputs are keyed by the saved value to reset with it. */
export function ProSettings({ settings, set }: { settings: Settings; set: (patch: Partial<Settings>) => void }) {
  // The default model applies to every project: only the global configuration's (D162).
  const models = usableModels(useQuery(environmentQuery).data?.models.available ?? [], null);
  const ids = models.map((m) => `${m.providerId}/${m.modelId}`);
  const model = settings['ai.defaultModel'];
  return (
    <Panel title={C.pro}>
      <div className="field">
        <label className="label" htmlFor="setting-model">
          {C.defaultModel}
        </label>
        <select
          id="setting-model"
          className="select"
          value={model ?? ''}
          onChange={(e) => set({ 'ai.defaultModel': e.target.value === '' ? null : e.target.value })}
        >
          <option value="">{C.opencodeDefault}</option>
          {model !== null && !ids.includes(model) && <option value={model}>{model}</option>}
          {models.map((m) => (
            <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>
              {m.name}（{m.providerId}/{m.modelId}）
            </option>
          ))}
        </select>
        <p className="hint">{C.defaultModelHint}</p>
      </div>
      <div className="field">
        <span className="label">{C.bashPolicy}</span>
        <Segmented
          label={C.bashPolicy}
          value={settings['ai.bashPolicy']}
          options={[
            { value: BashPolicy.Auto, label: C.bashAuto },
            { value: BashPolicy.Ask, label: C.bashAsk },
          ]}
          onChange={(v) => set({ 'ai.bashPolicy': v })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="setting-nodes-per-task">
          {C.nodesPerTask}
        </label>
        <NumberSetting
          key={settings['scheduler.maxConcurrentNodesPerTask']}
          id="setting-nodes-per-task"
          value={settings['scheduler.maxConcurrentNodesPerTask']}
          onCommit={(n) => set({ 'scheduler.maxConcurrentNodesPerTask': n })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="setting-max-attempts">
          {C.maxAttempts}
        </label>
        <NumberSetting
          key={settings['node.maxAttempts']}
          id="setting-max-attempts"
          value={settings['node.maxAttempts']}
          onCommit={(n) => set({ 'node.maxAttempts': n })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="setting-timeout">
          {C.timeoutMinutes}
        </label>
        <NumberSetting
          key={settings['attempt.timeoutMinutes']}
          id="setting-timeout"
          value={settings['attempt.timeoutMinutes']}
          onCommit={(n) => set({ 'attempt.timeoutMinutes': n })}
        />
        <p className="hint">{C.timeoutHint}</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="setting-commit-draft-timeout">
          {C.commitDraftTimeout}
        </label>
        <NumberSetting
          key={settings['git.commitDraftTimeoutSeconds']}
          id="setting-commit-draft-timeout"
          value={settings['git.commitDraftTimeoutSeconds']}
          onCommit={(n) => set({ 'git.commitDraftTimeoutSeconds': n })}
        />
        <p className="hint">{C.commitDraftTimeoutHint}</p>
      </div>
      <CommitIdentitySetting
        key={JSON.stringify(settings['git.commitIdentity'])}
        value={settings['git.commitIdentity']}
        onCommit={(v) => set({ 'git.commitIdentity': v })}
      />
      <div className="field">
        <span className="label">{C.defaultStrategy}</span>
        <Segmented
          label={C.defaultStrategy}
          value={settings['delivery.defaultStrategy']}
          options={LOCAL_MERGE_STRATEGIES.map((s) => ({ value: s, label: DELIVERY_COPY.strategies[s] }))}
          onChange={(v) => set({ 'delivery.defaultStrategy': v })}
        />
      </div>
      <div className="field row">
        <span className="label grow" id="setting-delete-branch">
          {C.deleteBranch}
        </span>
        <button
          type="button"
          role="switch"
          className="switch"
          aria-checked={settings['delivery.deleteBranchAfterMerge']}
          aria-labelledby="setting-delete-branch"
          onClick={() => set({ 'delivery.deleteBranchAfterMerge': !settings['delivery.deleteBranchAfterMerge'] })}
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="setting-worktree-root">
          {C.worktreeRoot}
        </label>
        <TextSetting
          key={settings['worktree.rootDir'] ?? ''}
          id="setting-worktree-root"
          value={settings['worktree.rootDir']}
          onCommit={(v) => set({ 'worktree.rootDir': v })}
        />
        <p className="hint">{C.worktreeRootHint}</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="setting-binary">
          {C.binaryPath}
        </label>
        <TextSetting
          key={settings['opencode.binaryPath'] ?? ''}
          id="setting-binary"
          value={settings['opencode.binaryPath']}
          onCommit={(v) => set({ 'opencode.binaryPath': v })}
        />
        <p className="hint">{C.binaryPathHint}</p>
      </div>
    </Panel>
  );
}
