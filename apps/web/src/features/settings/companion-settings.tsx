import { CompanionAppearance, companionAppearanceSchema, type Settings } from '@aw/shared';
import { useState } from 'react';
import { ExternalLink } from '../../components/external-link.tsx';
import { Panel } from '../../components/panel.tsx';
import { COMPANION_COPY as C } from '../../copy/companion.ts';
import { Character } from '../companion/character.tsx';
import { CHARACTER_CLIPS, type CharacterMood } from '../companion/character-assets.ts';
import styles from './companion-settings.module.css';

/** Simple mode shows whether it is on the desktop, how it looks and the notifications; the rest is pro (38 C5). */
export function CompanionSettings({
  settings,
  set,
  isPro,
}: {
  settings: Settings;
  set: (patch: Partial<Settings>) => void;
  isPro: boolean;
}) {
  const [mood, setMood] = useState<CharacterMood>('idle');
  const switches = [
    { key: 'companion.enabled', label: C.desktop, hint: window.aw === undefined ? C.desktopOnly : C.desktopHint },
    ...(isPro
      ? ([
          { key: 'companion.animations', label: C.animations },
          { key: 'companion.whisper', label: C.whisper, hint: C.whisperHint },
        ] as const)
      : []),
    { key: 'companion.notifications', label: C.notifications },
  ] as const;
  return (
    <Panel title={C.title}>
      <div className={styles.form}>
        <label className="field">
          <span className="label">{C.appearance}</span>
          <select
            className="input"
            aria-label={C.appearance}
            value={settings['companion.appearance']}
            onChange={(event) => set({ 'companion.appearance': companionAppearanceSchema.parse(event.target.value) })}
          >
            {Object.values(CompanionAppearance).map((value) => (
              <option value={value} key={value}>
                {C.appearances[value]}
              </option>
            ))}
          </select>
          <span className="hint">{C.appearanceHint}</span>
        </label>
        <div className="row">
          <Character size="lg" mood={mood} />
          <p className="hint">
            {C.source} <ExternalLink href={C.sourceUrl}>{C.sourceLink}</ExternalLink>
          </p>
        </div>
        <fieldset className={styles.motions} aria-label={C.preview}>
          {Object.keys(CHARACTER_CLIPS)
            .filter((value): value is CharacterMood => value in CHARACTER_CLIPS)
            .map((value) => (
              <button
                type="button"
                className="chip"
                aria-pressed={mood === value}
                key={value}
                onClick={() => setMood(value)}
              >
                {C.moods[value]}
              </button>
            ))}
        </fieldset>
        {switches.map((item) => (
          <div className="row" key={item.key}>
            <div className="grow col">
              <span className="label" id={item.key}>
                {item.label}
              </span>
              {'hint' in item && <span className="hint">{item.hint}</span>}
            </div>
            <button
              type="button"
              role="switch"
              className="switch"
              aria-checked={settings[item.key]}
              aria-labelledby={item.key}
              disabled={item.key === 'companion.enabled' && window.aw === undefined}
              onClick={() => set({ [item.key]: !settings[item.key] })}
            />
          </div>
        ))}
        {isPro && (
          <>
            <label className="field">
              <span className="label">
                {C.size} · {settings['companion.size']}
              </span>
              <input
                type="range"
                min={120}
                max={300}
                step={20}
                value={settings['companion.size']}
                onChange={(e) => set({ 'companion.size': Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span className="label">{C.whisperMinutes}</span>
              <select
                className="input"
                value={settings['companion.whisperMinutes']}
                onChange={(e) => set({ 'companion.whisperMinutes': Number(e.target.value) })}
              >
                {[1, 5, 15, 30, 60, 120].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
    </Panel>
  );
}
