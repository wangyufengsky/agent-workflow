import type { ProjectDTO } from '@aw/shared';
import { ASSISTANT_COPY as C } from '../../copy/assistant.ts';

export function ConversationProjectSelect({
  value,
  projects,
  onChange,
}: {
  value: string | null;
  projects: readonly ProjectDTO[];
  onChange: (id: string | null) => void;
}) {
  return (
    <label>
      {C.sessionProject}{' '}
      <select aria-label={C.sessionProject} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{C.generalConversation}</option>
        {value !== null && !projects.some((p) => p.id === value) && <option value={value}>{C.deletedProject}</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}
