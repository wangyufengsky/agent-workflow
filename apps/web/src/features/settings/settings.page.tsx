import { type Settings, themePreferenceSchema, UiMode } from '@aw/shared';
import { ErrorState } from '../../components/error-state.tsx';
import { Panel } from '../../components/panel.tsx';
import { SETTINGS_COPY as C } from '../../copy/settings.ts';
import { THEME_LABEL } from '../../copy/themes.ts';
import { AboutPanel } from './about-panel.tsx';
import { AssistantSettings } from './assistant-settings.tsx';
import { ProSettings } from './pro-settings.tsx';
import { NumberSetting, Segmented } from './setting-inputs.tsx';
import { useSettings, useUpdateSettings } from './settings.queries.ts';
import { WebsiteSettings } from './website-settings.tsx';

/** Settings (14 §3.7): the simple ones, and in pro mode the pro keys of `SETTING_MODE` (M5-08). */
export function SettingsPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const set = (patch: Partial<Settings>) => update.mutate(patch);
  const isPro = settings['ui.mode'] === UiMode.Pro;

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1 className="title grow">{C.title}</h1>
      </div>
      <div className="stack">
        <Panel title={C.appearance}>
          <div className="field">
            <span className="label">{C.theme}</span>
            <Segmented
              label={C.theme}
              value={settings['ui.theme']}
              options={themePreferenceSchema.options.map((t) => ({ value: t, label: THEME_LABEL[t] }))}
              onChange={(t) => set({ 'ui.theme': t })}
            />
            <p className="hint">{C.themeHint}</p>
          </div>
          <div className="row">
            <div className="grow col">
              <span className="label" id="intro-label">
                {C.intro}
              </span>
              <span className="hint">{C.introHint}</span>
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={settings['ui.introAnimation']}
              aria-labelledby="intro-label"
              onClick={() => set({ 'ui.introAnimation': !settings['ui.introAnimation'] })}
            />
          </div>
        </Panel>
        <Panel title={C.mode}>
          <div className="row">
            <div className="grow col">
              <span className="label" id="pro-mode-label">
                {C.proMode}
              </span>
              <span className="hint">{C.proModeHint}</span>
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={isPro}
              aria-labelledby="pro-mode-label"
              onClick={() => set({ 'ui.mode': isPro ? UiMode.Simple : UiMode.Pro })}
            />
          </div>
        </Panel>
        <Panel title={C.ai}>
          <div className="field">
            <span className="label">{C.uncertainty}</span>
            <Segmented
              label={C.uncertainty}
              value={settings['ai.askOnUncertainty'] ? 'ask' : 'assume'}
              options={[
                { value: 'assume', label: C.assume },
                { value: 'ask', label: C.ask },
              ]}
              onChange={(v) => set({ 'ai.askOnUncertainty': v === 'ask' })}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="concurrency">
              {C.concurrency}
            </label>
            <NumberSetting
              key={settings['scheduler.maxConcurrentAttempts']}
              id="concurrency"
              value={settings['scheduler.maxConcurrentAttempts']}
              onCommit={(n) => set({ 'scheduler.maxConcurrentAttempts': n })}
            />
            <p className="hint">{C.concurrencyHint}</p>
          </div>
        </Panel>
        <AssistantSettings settings={settings} set={set} />
        <WebsiteSettings settings={settings} set={set} />
        {isPro && <ProSettings settings={settings} set={set} />}
        {update.isError && <ErrorState error={update.error} />}
        <AboutPanel />
      </div>
    </div>
  );
}
