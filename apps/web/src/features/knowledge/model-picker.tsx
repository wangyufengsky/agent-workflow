import { useQuery } from '@tanstack/react-query';
import { KNOWLEDGE_COPY as C } from '../../copy/knowledge.ts';
import { environmentQuery } from '../onboarding/environment.queries.ts';
import styles from './knowledge.module.css';

/**
 * The model of the next question (D67 ④), a small select in the question box: opencode's models (the same list as
 * the role editor, M5-06), or its default (null).
 */
export function ModelPicker({ value, onChange }: { value: string | null; onChange(model: string | null): void }) {
  const models = useQuery(environmentQuery).data?.models.available ?? [];
  const ids = models.map((m) => `${m.providerId}/${m.modelId}`);
  return (
    <select
      className={styles.modelPick}
      aria-label={C.modelLabel}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">{C.modelOf(null)}</option>
      {value !== null && !ids.includes(value) && <option value={value}>{value}</option>}
      {models.map((m) => (
        <option key={`${m.providerId}/${m.modelId}`} value={`${m.providerId}/${m.modelId}`}>
          {m.name}
        </option>
      ))}
    </select>
  );
}
