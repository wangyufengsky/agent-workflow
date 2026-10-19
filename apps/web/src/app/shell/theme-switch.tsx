import { type ThemePreference, themePreferenceSchema } from '@aw/shared';
import { COMMON_COPY } from '../../copy/common.ts';
import { THEME_LABEL } from '../../copy/themes.ts';
import { useSettings, useUpdateSettings } from '../../features/settings/settings.queries.ts';

const PREFERENCES = themePreferenceSchema.options;

/** Header quick switch; the same `ui.theme` setting as the settings page. */
export function ThemeSwitch() {
  const theme = useSettings()['ui.theme'];
  const update = useUpdateSettings();
  return (
    <select
      className="select ctl fit"
      aria-label={COMMON_COPY.themeSwitch}
      value={theme}
      onChange={(e) => update.mutate({ 'ui.theme': themePreferenceSchema.parse(e.target.value) })}
    >
      {PREFERENCES.map((p: ThemePreference) => (
        <option key={p} value={p}>
          {THEME_LABEL[p]}
        </option>
      ))}
    </select>
  );
}
