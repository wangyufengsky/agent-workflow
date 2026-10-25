import { OPERATION_CONTRACTS, type Settings } from '@aw/shared';
import { Button } from '../../components/button.tsx';
import { Panel } from '../../components/panel.tsx';
import { ASSISTANT_SETTINGS_COPY as C } from '../../copy/assistant.ts';
import { operationTitle } from '../../copy/operations.ts';
import { ExternalMcp } from './external-mcp.tsx';

const titleOfOperation = new Map(OPERATION_CONTRACTS.map((op) => [op.id, operationTitle(op.title)]));

/** The「助手」group (15 §4): what the assistant may run without asking, and revoking it; the user's own MCP tools. */
export function AssistantSettings({ settings, set }: { settings: Settings; set: (patch: Partial<Settings>) => void }) {
  const allowed = settings['assistant.alwaysAllow'];
  return (
    <Panel title={C.title}>
      <div className="field">
        <span className="label">{C.alwaysAllow}</span>
        <p className="hint">{C.alwaysAllowHint}</p>
        {allowed.length === 0 ? (
          <p className="hint">{C.none}</p>
        ) : (
          <ul className="col" aria-label={C.alwaysAllow}>
            {allowed.map((id) => (
              <li key={id} className="row">
                {/* An id this version no longer has is still shown, so it can be revoked. */}
                <span className="grow">{titleOfOperation.get(id) ?? <span className="mono">{id}</span>}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ 'assistant.alwaysAllow': allowed.filter((a) => a !== id) })}
                >
                  {C.revoke}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ExternalMcp />
    </Panel>
  );
}
