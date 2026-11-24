import type { ModelEffort, ModelInfo } from '@aw/shared';
import { useId } from 'react';
import { SETTINGS_COPY as C } from '../copy/settings.ts';
import styles from './model-fields.module.css';

export function ModelFields({ children }: { children: React.ReactNode }) {
  return <div className={styles.fields}>{children}</div>;
}

export function effortLabel(id: string) {
  return C.effortLevels.find(([key]) => key === id)?.[1] ?? id;
}

/** OpenCode 的原始档位标识也可以与界面选项同名，用独立的值空间保存。 */
export function ModelEffortField({
  model,
  value,
  inherited,
  disabled,
  onChange,
}: {
  model: ModelInfo | undefined;
  value: ModelEffort | null;
  inherited?: ModelEffort | null;
  disabled?: boolean;
  onChange: (value: ModelEffort | null) => void;
}) {
  const id = useId();
  const key = model && model.providerId + '/' + model.modelId;
  const variants = model?.variants ?? [];
  const follow = inherited !== undefined;
  const override = value?.model === key ? value : null;
  const selected =
    override?.variant && variants.includes(override.variant)
      ? 'v:' + override.variant
      : follow && !override && variants.length
        ? 'inherit'
        : 'default';
  const global =
    inherited?.model === key && inherited?.variant && variants.includes(inherited.variant)
      ? effortLabel(inherited.variant)
      : C.effortDefault;
  return (
    <div className="field">
      <label htmlFor={id} className="label">
        {C.effort}
      </label>
      <select
        id={id}
        className="select"
        value={selected}
        disabled={disabled || !variants.length}
        onChange={(e) => {
          const v = e.target.value;
          onChange(
            !key || v === 'inherit' || (v === 'default' && !follow)
              ? null
              : { model: key, variant: v === 'default' ? null : v.slice(2) },
          );
        }}
      >
        {follow && variants.length > 0 && (
          <option value="inherit">
            {C.effortInherit} · {global}
          </option>
        )}
        <option value="default">{C.effortDefault}</option>
        {variants.map((v) => (
          <option key={v} value={'v:' + v}>
            {effortLabel(v)}
          </option>
        ))}
      </select>
      {!model && <span className="hint">{C.effortChooseModel}</span>}
      {model && !variants.length && <span className="hint">{C.effortUnavailable}</span>}
    </div>
  );
}
