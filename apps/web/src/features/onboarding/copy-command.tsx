import { useState } from 'react';
import { IconButton } from '../../components/icon-button.tsx';
import { ONBOARDING_COPY } from '../../copy/onboarding.ts';

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="row">
      <code className="chip mono">{command}</code>
      <IconButton
        icon={copied ? 'check' : 'copy'}
        label={copied ? ONBOARDING_COPY.copied : ONBOARDING_COPY.copyCommand}
        onClick={async () => {
          await navigator.clipboard.writeText(command);
          setCopied(true);
        }}
      />
    </div>
  );
}
