import type { SkillRef } from '@aw/shared';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import styles from './skills.module.css';

export function UsedSkills({ skills, label = C.used }: { skills: readonly SkillRef[]; label?: string }) {
  return (
    <div className={`hint ${styles.used}`}>
      {label}
      {skills.map(({ id, name, version }) => (
        <span className="mono" key={id}>
          {name} · {C.version(version)}
        </span>
      ))}
    </div>
  );
}
