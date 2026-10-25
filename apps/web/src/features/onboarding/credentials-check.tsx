import {
  changeMasterPasswordOp,
  type EnvironmentDTO,
  MASTER_PASSWORD_MIN_LENGTH,
  MasterPasswordState,
  resetMasterPasswordOp,
  StatusTone,
  setupMasterPasswordOp,
  unlockCredentialsOp,
} from '@aw/shared';
import { type FormEvent, useState } from 'react';
import { callOperation } from '../../api/client.ts';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { ErrorState } from '../../components/error-state.tsx';
import { toast } from '../../components/toast.tsx';
import { ONBOARDING_COPY } from '../../copy/onboarding.ts';
import { CheckRow } from './check-row.tsx';
import { CopyCommand } from './copy-command.tsx';
import { useCredentialMutation } from './environment.queries.ts';

const C = ONBOARDING_COPY.credentials;

function PasswordField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SetupForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const setup = useCredentialMutation((p: string) => callOperation(setupMasterPasswordOp, { password: p }));
  const mismatch = confirm !== '' && confirm !== password;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setup.mutate(password, { onSuccess: () => toast(C.setupDone) });
  };
  return (
    <form className="col" onSubmit={submit} aria-label={C.setup}>
      <span className="hint">{C.orMasterPassword}</span>
      <PasswordField id="master-password" label={C.password} value={password} onChange={setPassword} />
      <PasswordField id="master-password-confirm" label={C.confirmPassword} value={confirm} onChange={setConfirm} />
      <p className="hint">{mismatch ? C.mismatch : C.masterPasswordHint(MASTER_PASSWORD_MIN_LENGTH)}</p>
      {setup.isError && <ErrorState error={setup.error} />}
      <div className="row">
        <Button
          type="submit"
          size="sm"
          pending={setup.isPending}
          disabled={password.length < MASTER_PASSWORD_MIN_LENGTH || confirm !== password}
        >
          {C.setup}
        </Button>
      </div>
    </form>
  );
}

function ResetButton() {
  const [open, setOpen] = useState(false);
  const reset = useCredentialMutation(() => callOperation(resetMasterPasswordOp, {}));
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {C.forgot}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={C.resetTitle}
        footer={
          <Button
            variant="danger"
            pending={reset.isPending}
            onClick={() =>
              reset.mutate(undefined, {
                onSuccess: () => {
                  toast(C.resetDone);
                  setOpen(false);
                },
              })
            }
          >
            {C.reset}
          </Button>
        }
      >
        <p>{C.resetBody}</p>
        {reset.isError && <ErrorState error={reset.error} />}
      </Dialog>
    </>
  );
}

function UnlockForm() {
  const [password, setPassword] = useState('');
  const unlock = useCredentialMutation((p: string) => callOperation(unlockCredentialsOp, { password: p }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    unlock.mutate(password, { onSuccess: () => toast(C.unlockDone) });
  };
  return (
    <form className="col" onSubmit={submit} aria-label={C.unlock}>
      <PasswordField id="master-password-unlock" label={C.password} value={password} onChange={setPassword} />
      {unlock.isError && <ErrorState error={unlock.error} />}
      <div className="row">
        <Button type="submit" size="sm" pending={unlock.isPending} disabled={password === ''}>
          {C.unlock}
        </Button>
        <ResetButton />
      </div>
    </form>
  );
}

function ChangeForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const change = useCredentialMutation((input: { currentPassword: string; newPassword: string }) =>
    callOperation(changeMasterPasswordOp, input),
  );
  const mismatch = confirm !== '' && confirm !== next;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast(C.changeDone);
          onDone();
        },
      },
    );
  };
  return (
    <form className="col" onSubmit={submit} aria-label={C.change}>
      <PasswordField id="master-password-current" label={C.currentPassword} value={current} onChange={setCurrent} />
      <PasswordField id="master-password-new" label={C.newPassword} value={next} onChange={setNext} />
      <PasswordField id="master-password-new-confirm" label={C.confirmPassword} value={confirm} onChange={setConfirm} />
      <p className="hint">{mismatch ? C.mismatch : C.masterPasswordHint(MASTER_PASSWORD_MIN_LENGTH)}</p>
      {change.isError && <ErrorState error={change.error} />}
      <div className="row">
        <Button
          type="submit"
          size="sm"
          pending={change.isPending}
          disabled={current === '' || next.length < MASTER_PASSWORD_MIN_LENGTH || confirm !== next}
        >
          {C.change}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {C.cancel}
        </Button>
      </div>
    </form>
  );
}

function Unlocked({ system }: { system: boolean }) {
  const [changing, setChanging] = useState(false);
  return (
    <>
      <span className="hint">{system ? C.unlockedWithSystem : C.unlocked}</span>
      {changing ? (
        <ChangeForm onDone={() => setChanging(false)} />
      ) : (
        <div className="row">
          <Button size="sm" onClick={() => setChanging(true)}>
            {C.change}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Secrets need the OS key store, or else the master password (D74, D167). Without either only storing tokens and
 * passwords fails, so this is a warning, never part of「全部通过」.
 */
export function CredentialsCheck({ environment }: { environment: EnvironmentDTO }) {
  const { credentials, platform } = environment;
  const fix = C.fix[platform];
  switch (credentials.masterPassword) {
    case MasterPasswordState.Unlocked:
      return (
        <CheckRow title={C.title} tone={StatusTone.Ok} badge={ONBOARDING_COPY.ready}>
          <Unlocked system={credentials.system} />
        </CheckRow>
      );
    case MasterPasswordState.Locked:
      return (
        <CheckRow title={C.title} tone={StatusTone.Warn} badge={C.lockedBadge}>
          <span className="hint">{C.locked}</span>
          <UnlockForm />
        </CheckRow>
      );
    case MasterPasswordState.None:
      return credentials.system ? (
        <CheckRow title={C.title} tone={StatusTone.Ok} badge={ONBOARDING_COPY.ready}>
          <span className="hint">{C.available}</span>
        </CheckRow>
      ) : (
        <CheckRow title={C.title} tone={StatusTone.Warn} badge={C.unavailableBadge}>
          <span className="hint">{C.unavailable}</span>
          {fix !== null && <CopyCommand command={fix} />}
          <SetupForm />
        </CheckRow>
      );
  }
}
