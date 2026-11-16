import { SKILL_SELECTION_MAX, type UserSkillDTO } from '@aw/shared';
import { SKILLS_COPY as C } from '../../copy/skills.ts';
import styles from './skills.module.css';

export function SkillOptions({
  items,
  selected,
  onChange,
}: {
  items: readonly UserSkillDTO[];
  selected: readonly string[];
  onChange(ids: string[]): void;
}) {
  return (
    <div className={styles.options}>
      {items.map((skill) => {
        const checked = selected.includes(skill.id);
        return (
          <label className={styles.option} key={skill.id}>
            <input
              type="checkbox"
              checked={checked}
              disabled={!checked && selected.length >= SKILL_SELECTION_MAX}
              onChange={() => onChange(checked ? selected.filter((id) => id !== skill.id) : [...selected, skill.id])}
            />
            <span className={styles.optionText}>
              <strong>{skill.name}</strong>
              <small>{skill.description}</small>
            </span>
            <span className="hint mono">{C.version(skill.version)}</span>
          </label>
        );
      })}
    </div>
  );
}
