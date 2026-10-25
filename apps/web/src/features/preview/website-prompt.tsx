import type { BrowserPrompt } from '@aw/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../components/button.tsx';
import { Dialog } from '../../components/dialog.tsx';
import { WEBSITE_PROMPT_COPY as C } from '../../copy/browser.ts';

type LoginPrompt = Extract<BrowserPrompt, { kind: 'login' }>;
type CertificatePrompt = Extract<BrowserPrompt, { kind: 'certificate' }>;

/** HTTP authentication: what the user types goes to main and on to the website only (29 §5.4). */
function LoginDialog({ prompt, done }: { prompt: LoginPrompt; done: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const answer = (credentials: { username: string; password: string } | null) => {
    window.aw?.browser.answerPrompt({ kind: 'login', id: prompt.id, credentials });
    done();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && answer(null)}
      title={prompt.isProxy ? C.proxyTitle(prompt.host) : C.loginTitle(prompt.host)}
      description={C.loginLede(prompt.realm)}
      footer={
        <>
          <Button onClick={() => answer(null)}>{C.cancel}</Button>
          <Button variant="primary" type="submit" form="website-login">
            {C.login}
          </Button>
        </>
      }
    >
      <form
        id="website-login"
        className="col"
        onSubmit={(e) => {
          e.preventDefault();
          answer({ username, password });
        }}
      >
        <label className="field">
          <span className="label">{C.username}</span>
          <input
            className="input"
            autoComplete="off"
            value={username}
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="label">{C.password}</span>
          <input
            className="input"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </form>
    </Dialog>
  );
}

/** A client certificate: the user picks one of what the system store offers (29 §5.4). */
function CertificateDialog({ prompt, done }: { prompt: CertificatePrompt; done: () => void }) {
  const [picked, setPicked] = useState(prompt.certificates[0]?.fingerprint ?? null);
  const answer = (fingerprint: string | null) => {
    window.aw?.browser.answerPrompt({ kind: 'certificate', id: prompt.id, fingerprint });
    done();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && answer(null)}
      title={C.certificateTitle(prompt.host)}
      description={C.certificateLede}
      footer={
        <>
          <Button onClick={() => answer(null)}>{C.cancel}</Button>
          <Button variant="primary" disabled={picked === null} onClick={() => answer(picked)}>
            {C.useCertificate}
          </Button>
        </>
      }
    >
      {prompt.certificates.length === 0 ? (
        <p className="hint">{C.certificateNone}</p>
      ) : (
        <fieldset className="col">
          {prompt.certificates.map((c) => (
            <label key={c.fingerprint} className="row">
              <input
                type="radio"
                name="website-certificate"
                checked={picked === c.fingerprint}
                onChange={() => setPicked(c.fingerprint)}
              />
              <span className="col">
                <b>{c.subject}</b>
                <small className="hint">
                  {C.issuer(c.issuer)} · {C.expires(new Date(c.validExpiry * 1000).toLocaleDateString('zh-CN'))}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}

/**
 * What websites ask of the user's own tabs (the preview, a website login), one at a time. Opening the dialog takes
 * the native tab off the window (`usePlacedTab`), closing it puts it back.
 */
export function WebsitePrompts() {
  const [queue, setQueue] = useState<BrowserPrompt[]>([]);
  useEffect(() => window.aw?.browser.onPrompt((prompt) => setQueue((q) => [...q, prompt])), []);
  const prompt = queue[0];
  if (prompt === undefined) return null;
  const done = () => setQueue((q) => q.slice(1));
  return prompt.kind === 'login' ? (
    <LoginDialog key={prompt.id} prompt={prompt} done={done} />
  ) : (
    <CertificateDialog key={prompt.id} prompt={prompt} done={done} />
  );
}
