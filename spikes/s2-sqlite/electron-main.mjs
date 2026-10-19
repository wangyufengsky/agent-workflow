// Runs run.ts inside a real Electron utilityProcess, then quits.
import { join } from 'node:path';
import { app, utilityProcess } from 'electron';

app.whenReady().then(() => {
  const child = utilityProcess.fork(join(import.meta.dirname, 'run.ts'), [], { stdio: 'inherit' });
  child.on('message', () => setTimeout(() => app.quit(), 100));
  child.on('exit', (code) => {
    if (code !== 0) {
      console.error('utilityProcess exit', code);
      app.exit(1);
    }
  });
});
