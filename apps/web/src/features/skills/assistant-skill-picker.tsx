import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ROUTES } from '../../app/routes.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import { SkillOptions } from './skill-options.tsx';
import { skillsQuery } from './skills.queries.ts';

export function AssistantSkillPicker({ selected, onChange }: { selected: string[]; onChange(ids: string[]): void }) {
  const [open, setOpen] = useState(false);
  const library = useQuery({ ...skillsQuery, enabled: open });
  const options = library.data?.filter((skill) => skill.assistantEnabled);
  return (
    <>
      <Button
        size="sm"
        variant={selected.length > 0 ? 'secondary' : 'ghost'}
        type="button"
        aria-label={C.pick}
        onClick={() => setOpen(true)}
      >
        {selected.length === 0 ? C.pick : C.selected(selected.length)}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={C.pickForMessage}
        footer={
          <>
            <Button type="button" variant="ghost" disabled={selected.length === 0} onClick={() => onChange([])}>
              {C.clear}
            </Button>
            <Button type="button" variant="primary" onClick={() => setOpen(false)}>
              {C.done}
            </Button>
          </>
        }
      >
        {library.isPending && <span className="spin" />}
        {library.isError && <ErrorState error={library.error} onRetry={() => void library.refetch()} />}
        {options?.length === 0 && <p className="hint">{C.noAssistantSkills}</p>}
        {options !== undefined && <SkillOptions items={options} selected={selected} onChange={onChange} />}
        <p>
          <Link to={ROUTES.skills} onClick={() => setOpen(false)} className="link">
            {C.title}
          </Link>
        </p>
      </Dialog>
    </>
  );
}
