import { CompanionAppearance } from '@aw/shared';
import { useState, useSyncExternalStore } from 'react';
import { COMPANION_COPY as C } from '../../copy/companion.ts';
import { useSettings } from '../settings/settings.queries.ts';
import styles from './character.module.css';
import { CHARACTER_CLIPS, CHARACTER_POSTER, type CharacterMood, clipUrl } from './character-assets.ts';
import { useCompanionUi, useCompanionWorking } from './companion-events.ts';
import orb from './orb.module.css';

const media = () => window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribe = (listener: () => void) => {
  const query = media();
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => media().matches);

function Clip({ clip, onEnded }: { clip: string; onEnded?: () => void }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className={styles.failure} role="status">
      {C.loadFailed}
    </span>
  ) : (
    <video
      src={clipUrl(clip)}
      poster={CHARACTER_POSTER}
      autoPlay
      muted
      playsInline
      loop={onEnded === undefined}
      onEnded={onEnded}
      onError={() => setFailed(true)}
    />
  );
}

export function Character({
  mood: requestedMood,
  size = 'sm',
  action,
  onEnded,
}: {
  mood?: CharacterMood | undefined;
  size?: 'xs' | 'sm' | 'lg' | 'pet';
  action?: string;
  onEnded?: () => void;
}) {
  const reduced = useReducedMotion();
  const settings = useSettings();
  const noticeMood = useCompanionUi((s) => s.notices[0]?.mood);
  const working = useCompanionWorking();
  const mood = requestedMood ?? noticeMood ?? (working ? 'working' : 'idle');
  const animated = settings['companion.animations'] && !reduced && size !== 'xs';
  const appearance = settings['companion.appearance'];
  const clip = action ?? CHARACTER_CLIPS[mood];
  if (appearance === CompanionAppearance.Orb) {
    return (
      <span
        className={orb.frame}
        data-size={size}
        data-mood={mood}
        data-animated={animated}
        data-appearance={appearance}
        role="img"
        aria-label={`${C.appearances[appearance]} · ${C.moods[mood]}`}
      >
        <span className={orb.body} />
        <span className={orb.ring} />
      </span>
    );
  }
  return (
    <span
      className={styles.character}
      data-size={size}
      data-mood={mood}
      data-appearance={appearance}
      role="img"
      aria-label={`${C.name} · ${C.moods[mood]}`}
    >
      {animated ? (
        <Clip key={clip} clip={clip} {...(onEnded === undefined ? {} : { onEnded })} />
      ) : (
        <img src={CHARACTER_POSTER} alt="" />
      )}
    </span>
  );
}
