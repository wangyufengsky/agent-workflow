import { isUnmet } from '@aw/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/icon.tsx';
import { REQUIREMENTS_COPY as C } from '../../copy/requirements.ts';
import { requirementsQuery } from './requirements.queries.ts';

/**
 * Before delivery (31 §4): required items not met are listed and the user accepts them for this checklist version.
 * `ack` goes with the delivery; `blocked` until the user accepts.
 */
export function useDeliveryAcknowledgement(taskId: string) {
  const { data } = useQuery(requirementsQuery(taskId));
  const [accepted, setAccepted] = useState(false);
  const unmet = data?.items.filter((i) => i.required && isUnmet(i.status)) ?? [];
  const revisionId = data?.revision?.id;
  return {
    unmet,
    accepted,
    setAccepted,
    blocked: unmet.length > 0 && !accepted,
    ack:
      unmet.length > 0 && accepted && revisionId !== undefined
        ? { acknowledgedRequirementsRevisionId: revisionId }
        : {},
  };
}

export function UnmetNotice({ acknowledgement }: { acknowledgement: ReturnType<typeof useDeliveryAcknowledgement> }) {
  const { unmet, accepted, setAccepted } = acknowledgement;
  if (unmet.length === 0) return null;
  return (
    <div className="banner warn" role="status" data-testid="unmet-requirements">
      <Icon name="alert" />
      <div className="grow col">
        <strong>{C.unmetTitle(unmet.length)}</strong>
        <ul>
          {unmet.map((i) => (
            <li key={i.id}>
              {i.title}（{C.statusLabel[i.status]}）
            </li>
          ))}
        </ul>
        <label className="check">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>{C.unmetAck}</span>
        </label>
      </div>
    </div>
  );
}
