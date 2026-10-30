import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createConnection, createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// Electron smoke for CI on every platform (17 §4.1): the built app starts its backend, shows onboarding with the
// checks answered, and quits cleanly (main waits for the backend to stop opencode and exit). No opencode or model
// is needed; the full journey with them is J10. The window comes first with the opening animation, which a click
// skips (28 §5, D113).
async function launch(userDataDir: string) {
  const executablePath = process.env.AW_E2E_EXECUTABLE_PATH;
  return await electron.launch({
    ...(executablePath === undefined ? {} : { executablePath }),
    args: [...(executablePath === undefined ? ['apps/desktop'] : []), `--user-data-dir=${userDataDir}`],
  });
}

test('构建后的应用启动后显示引导页并能正常退出', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-launch-'));
  const app = await launch(userDataDir);
  // What main and the backend printed, kept for a failure: it is intermittent on CI only (07 §1).
  const output: string[] = [];
  app.process().stdout?.on('data', (chunk) => output.push(String(chunk)));
  app.process().stderr?.on('data', (chunk) => output.push(String(chunk)));
  const page = await app.firstWindow();
  try {
    await expect(page.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
    await page.mouse.click(10, 10);

    await expect(page.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
    await expect(page.getByTestId('check-Git')).toContainText('已就绪');
    await expect(page.getByTestId('check-opencode')).toBeVisible();
    await expect(page.getByTestId('check-凭据存储')).toBeVisible();
    // The next start shows its window in the theme the renderer applied, before the backend is up (28 §5.3).
    const launchFile = join(userDataDir, 'launch.json');
    await expect.poll(() => existsSync(launchFile)).toBe(true);
    expect(JSON.parse(readFileSync(launchFile, 'utf8'))).toMatchObject({ intro: true });
  } catch (err) {
    // Written under the test's output directory, which CI uploads; each step bounded, a hung renderer included.
    const info = test.info();
    writeFileSync(info.outputPath('process-output.txt'), output.join(''));
    const windows = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => ({
        url: w.webContents.getURL(),
        loading: w.webContents.isLoading(),
        crashed: w.webContents.isCrashed(),
        visible: w.isVisible(),
      })),
    );
    writeFileSync(info.outputPath('windows.json'), JSON.stringify(windows, null, 2));
    const logs = join(userDataDir, 'logs');
    for (const file of existsSync(logs) ? readdirSync(logs) : []) copyFileSync(join(logs, file), info.outputPath(file));
    // A screenshot that cannot be taken says the renderer is not painting: recorded, the original failure rethrown.
    await page
      .screenshot({ path: info.outputPath('page.png'), timeout: 5000 })
      .catch((e: unknown) => writeFileSync(info.outputPath('screenshot-error.txt'), String(e)));
    throw err;
  }

  await app.close();
});

test('退出时释放应用预连接，后端与桌面进程都能正常结束', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aw-e2e-preconnect-'));
  const app = await launch(userDataDir);
  const child = app.process();
  const sockets = new Set<Socket>();
  const connected = Promise.withResolvers<void>();
  const errors: Error[] = [];
  let bytes = 0;
  let backendPort = 0;
  let closed = false;
  let closing: Promise<void> | undefined;
  // TCP 转发保留真实预连接；两端的 connect 事件提供跨平台屏障，不依赖 sleep 或 lsof。
  const proxy = createServer((incoming) => {
    const outgoing = createConnection({ host: '127.0.0.1', port: backendPort });
    for (const socket of [incoming, outgoing]) {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      socket.on('error', (error) => errors.push(error));
    }
    incoming.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
    });
    incoming.pipe(outgoing);
    outgoing.pipe(incoming);
    outgoing.once('connect', () => connected.resolve());
  });
  async function closeApp(): Promise<void> {
    await app.close();
    closed = true;
  }
  try {
    const main = await app.firstWindow();
    await expect(main.getByRole('heading', { name: 'Everything is a Workflow.' })).toBeVisible();
    await main.mouse.click(10, 10);
    await expect(main.getByRole('heading', { name: '欢迎使用 Agent Workflow' })).toBeVisible();
    backendPort = Number(new URL(main.url()).port);
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (address === null || typeof address === 'string') throw new Error('TCP proxy has no port');
    await app.evaluate(({ session }, port) => {
      session.defaultSession.preconnect({ url: `http://127.0.0.1:${port}`, numSockets: 1 });
    }, address.port);
    await connected.promise;
    closing = closeApp();
    await expect.poll(() => closed).toBe(true);
    await closing;
    expect(child.exitCode).toBe(0);
    expect(bytes).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    // 旧代码会等到预连接关闭；断言失败也只清理本用例的 socket，随后走应用自己的退出流程。
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await (closing ?? app.close());
  }
});
