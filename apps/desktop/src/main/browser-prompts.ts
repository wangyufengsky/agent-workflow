import {
  type BrowserCertificatePrompt,
  type BrowserCredentials,
  type BrowserLoginPrompt,
  type BrowserPrompt,
  type BrowserPromptAnswer,
  browserPromptAnswerSchema,
} from '@aw/shared';
import { type BrowserWindow, ipcMain } from 'electron';

/** What the user's own tab asks the user (29 §5.4): their answer, or null when they cancel. */
export type BrowserPrompts = {
  login(prompt: BrowserLoginPrompt): Promise<BrowserCredentials | null>;
  /** The fingerprint of the certificate chosen. */
  certificate(prompt: BrowserCertificatePrompt): Promise<string | null>;
  /** The page that would answer started over (a reload): what it was asked is cancelled. */
  cancelAll(): void;
};

/**
 * Asks the user in the window's page and hands the answer back to Chromium. Passwords go from the renderer to main to
 * Chromium only: never to the backend, never to disk (D122).
 */
export function createBrowserPrompts(window: () => BrowserWindow | null): BrowserPrompts {
  let next = 0;
  const pending = new Map<number, (answer: BrowserPromptAnswer | null) => void>();

  // The renderer is a boundary: its answer is parsed, and one to a question no longer asked does nothing.
  ipcMain.on('aw:browser-prompt-answer', (_e, raw: unknown) => {
    const answer = browserPromptAnswerSchema.parse(raw);
    const settle = pending.get(answer.id);
    pending.delete(answer.id);
    settle?.(answer);
  });

  function ask(prompt: BrowserPrompt): Promise<BrowserPromptAnswer | null> {
    const win = window();
    if (win === null || win.isDestroyed()) return Promise.resolve(null);
    return new Promise((resolve) => {
      pending.set(prompt.id, resolve);
      win.webContents.send('aw:browser-prompt', prompt);
    });
  }

  return {
    async login(prompt) {
      const answer = await ask({ kind: 'login', id: ++next, ...prompt });
      return answer?.kind === 'login' ? answer.credentials : null;
    },
    async certificate(prompt) {
      const answer = await ask({ kind: 'certificate', id: ++next, ...prompt });
      return answer?.kind === 'certificate' ? answer.fingerprint : null;
    },
    cancelAll() {
      for (const settle of pending.values()) settle(null);
      pending.clear();
    },
  };
}
