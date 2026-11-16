import type { ProjectDTO } from '@aw/shared';
import { ProjectPicker } from '../projects/project-picker.tsx';

export function ConversationProjectSelect({
  value,
  projects,
  onChange,
}: {
  value: string | null;
  projects: readonly ProjectDTO[];
  onChange: (id: string | null) => void;
}) {
  return <ProjectPicker projects={projects} value={value ?? ''} onChange={(id) => onChange(id || null)} conversation />;
}
