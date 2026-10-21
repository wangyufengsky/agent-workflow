import {
  SCHEDULE_EVERY_HOURS,
  type ScheduleFrequency,
  ScheduleFrequencyKind,
  scheduleTimesOfDay,
  timeOfMinutes,
} from '@aw/shared';
import { SCHEDULES_COPY as C, SCHEDULE_KIND_LABEL, WEEKDAYS_SHOWN, weekdayLabel } from '../../copy/schedules.ts';

type EveryHours = (typeof SCHEDULE_EVERY_HOURS)[number];

/** Every field of the three presets, so switching between them keeps what was chosen. */
export type FrequencyDraft = { kind: ScheduleFrequencyKind; time: string; weekdays: number[]; everyHours: EveryHours };

export const DEFAULT_FREQUENCY: FrequencyDraft = {
  kind: ScheduleFrequencyKind.Daily,
  time: '02:00',
  weekdays: [1],
  everyHours: 6,
};

export function draftOf(frequency: ScheduleFrequency): FrequencyDraft {
  return { ...DEFAULT_FREQUENCY, ...frequency };
}

/** The frequency to save; undefined while the draft is not one (no weekday chosen, time cleared). */
export function frequencyOf(draft: FrequencyDraft): ScheduleFrequency | undefined {
  if (!/^\d{2}:\d{2}$/.test(draft.time)) return undefined;
  switch (draft.kind) {
    case ScheduleFrequencyKind.Daily:
      return { kind: draft.kind, time: draft.time };
    case ScheduleFrequencyKind.Weekly:
      return draft.weekdays.length === 0 ? undefined : { kind: draft.kind, weekdays: draft.weekdays, time: draft.time };
    case ScheduleFrequencyKind.Hourly:
      return { kind: draft.kind, everyHours: draft.everyHours, time: draft.time };
  }
}

const isEveryHours = (n: number): n is EveryHours => SCHEDULE_EVERY_HOURS.some((h) => h === n);

/** 「多久一次」(22 §2, D90): every day, chosen weekdays, or every few hours — always at a time of day. */
export function FrequencyPicker({ value, onChange }: { value: FrequencyDraft; onChange: (v: FrequencyDraft) => void }) {
  const frequency = frequencyOf(value);
  const toggleDay = (day: number) =>
    onChange({
      ...value,
      weekdays: value.weekdays.includes(day) ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day],
    });
  return (
    <div className="col">
      <fieldset className="seg" aria-label={C.frequency}>
        {Object.values(ScheduleFrequencyKind).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={value.kind === kind}
            onClick={() => onChange({ ...value, kind })}
          >
            {SCHEDULE_KIND_LABEL[kind]}
          </button>
        ))}
      </fieldset>
      {value.kind === ScheduleFrequencyKind.Weekly && (
        <div className="field">
          <span className="label">{C.weekdays}</span>
          <fieldset className="seg" aria-label={C.weekdays}>
            {WEEKDAYS_SHOWN.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={value.weekdays.includes(day)}
                onClick={() => toggleDay(day)}
              >
                {weekdayLabel(day)}
              </button>
            ))}
          </fieldset>
          {value.weekdays.length === 0 && <span className="error-text">{C.noWeekday}</span>}
        </div>
      )}
      <div className="row">
        {value.kind === ScheduleFrequencyKind.Hourly && (
          <div className="field">
            <label className="label" htmlFor="schedule-every">
              {C.everyHours}
            </label>
            <select
              id="schedule-every"
              className="select"
              value={value.everyHours}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (isEveryHours(n)) onChange({ ...value, everyHours: n });
              }}
            >
              {SCHEDULE_EVERY_HOURS.map((n) => (
                <option key={n} value={n}>
                  {C.hours(n)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="schedule-time">
            {value.kind === ScheduleFrequencyKind.Hourly ? C.startAt : C.time}
          </label>
          <input
            id="schedule-time"
            className="input"
            type="time"
            required
            value={value.time}
            onChange={(e) => onChange({ ...value, time: e.target.value })}
          />
        </div>
      </div>
      {value.kind === ScheduleFrequencyKind.Hourly && frequency !== undefined && (
        <span className="hint">{C.timesOfDay(scheduleTimesOfDay(frequency).map(timeOfMinutes).join('、'))}</span>
      )}
    </div>
  );
}
