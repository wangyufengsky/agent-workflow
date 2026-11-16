import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FRONTEND_WORKFLOW_KEY,
  initGitOp,
  type OperationContract,
  type TaskDetailDTO,
  taskDetailSchema,
  toOperationRequest,
} from '@aw/shared';
import { _electron as electron, expect, test } from '@playwright/test';
import type { z } from 'zod';
import { type FakeStep, passReview, submitResult } from './helpers.ts';

const nativeVue = process.env.AW_E2E_FRONTEND_VUE === '1';
const packageName = 'aw-frontend-fixture';
const html = (label: string) => `<!doctype html><html lang="zh"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>订单工作台</title>
<style>
*{box-sizing:border-box} body{margin:0;padding:20px;background:#f2f4f8;color:#192b41;font:15px/1.6 system-ui}
main{max-width:780px;margin:auto;padding:24px;background:#fff;border:1px solid #d3dbea;border-radius:12px}
h1{margin:0 0 20px;font-size:23px} label,button{display:block;margin:12px 0} input{padding:6px}
button{padding:8px 18px;background:#133467;color:white;border:0;border-radius:6px} p{border-top:1px solid #eee;padding:9px 0}
</style>
<body><main id="app">${
  nativeVue
    ? ''
    : `<h1>订单工作台</h1>
<label>搜索订单 <input></label><button id="export">${label}</button><p>订单 A1001　待发货</p><p>订单 A1002　已签收</p>`
}
</main>${nativeVue ? '<script type="module" src="/main.js"></script>' : ''}</body></html>`;
const script = (label: string) => `import { createApp, h } from 'vue';
createApp({ render: () => [
  h('h1', '订单工作台'), h('label', ['搜索订单 ', h('input')]),
  h('button', { id:'export' }, ${JSON.stringify(label)}),
  h('p', '订单 A1001　待发货'), h('p', '订单 A1002　已签收')
]}).mount('#app');`;
const server = `import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(readFileSync(new URL('./index.html', import.meta.url)));
}).listen(Number(process.env.PORT), '127.0.0.1');`;

const editPage = (label: string): FakeStep =>
  nativeVue
    ? { type: 'edit', file: 'main.js', content: script(label) }
    : { type: 'edit', file: 'index.html', content: html(label) };

test('前端任务从空目录启动真实预览，手机视口点选两轮后再完成验收', async ({ request }, testInfo) => {
  test.setTimeout(nativeVue ? 180_000 : 90_000);
  const app = await electron.launch({ args: ['e2e/fixtures/user-preview/main.cjs'] });
  try {
    const base = await app.evaluate(async () => globalThis.previewHarness.ready);
    const token = await app.evaluate(() => globalThis.previewHarness.token);
    const dataDir = await app.evaluate(() => globalThis.previewHarness.dataDir);
    const headers = { Authorization: `Bearer ${token}` };
    const call = async <I extends z.ZodObject, O extends z.ZodType>(
      op: OperationContract<I, O>,
      input: z.input<I>,
    ): Promise<z.output<O>> => {
      const { method, url, body } = toOperationRequest(op, input);
      const response = await request.fetch(`${base}${url}`, {
        method,
        data: body,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      await expect(response).toBeOK();
      return op.output.parse(await response.json());
    };
    const api = `${base}/api/v1`;
    async function queue(match: { title?: string; agent?: string }, steps: FakeStep[]) {
      await expect(
        await request.post(`${api}/dev/fake-opencode/scripts`, { headers, data: { match, steps } }),
      ).toBeOK();
    }
    const repoPath = mkdtempSync(join(tmpdir(), 'aw-frontend-e2e-project-'));
    const project = await call(initGitOp, { repoPath });
    expect(project.preview).toBeNull();
    const workflows = (await (await request.get(`${api}/workflows`, { headers })).json()).items;
    const workflow = workflows.find((item: { key: string }) => item.key === FRONTEND_WORKFLOW_KEY);

    const manifest = {
      name: packageName,
      private: true,
      version: '1.0.0',
      type: 'module',
      scripts: nativeVue
        ? { dev: 'vite', build: 'vite build' }
        : { dev: 'node server.mjs', build: 'node --check server.mjs' },
      ...(nativeVue ? { dependencies: { vue: '3.5.13' }, devDependencies: { vite: '8.3.4' } } : {}),
    };
    const vueLock = nativeVue
      ? (() => {
          const dir = mkdtempSync(join(tmpdir(), 'aw-frontend-vue-manifest-'));
          writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
          execFileSync('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: dir, stdio: 'inherit' });
          return readFileSync(join(dir, 'pnpm-lock.yaml'), 'utf8');
        })()
      : null;
    await queue({ title: '开发首版页面' }, [
      { type: 'edit', file: '.gitignore', content: 'node_modules/\ndist/\n.DS_Store\n' },
      { type: 'edit', file: 'package.json', content: JSON.stringify(manifest) },
      ...(vueLock !== null
        ? [
            { type: 'edit' as const, file: 'pnpm-lock.yaml', content: vueLock },
            { type: 'edit' as const, file: 'index.html', content: html('导出') },
            editPage('导出'),
          ]
        : [
            { type: 'edit' as const, file: 'server.mjs', content: server },
            {
              type: 'edit' as const,
              file: 'package-lock.json',
              content: JSON.stringify({
                name: packageName,
                version: '1.0.0',
                lockfileVersion: 3,
                requires: true,
                packages: { '': { name: packageName, version: '1.0.0' } },
              }),
            },
            editPage('导出'),
          ]),
      submitResult('订单页面已可预览'),
    ]);
    const started = await request.post(`${api}/tasks`, {
      headers,
      data: {
        projectId: project.id,
        workflowId: workflow.id,
        requirement: '从零创建订单页，手机上可操作',
      },
    });
    await expect(started).toBeOK();
    const task = taskDetailSchema.parse(await started.json());
    const detail = async (): Promise<TaskDetailDTO> =>
      taskDetailSchema.parse(await (await request.get(`${api}/tasks/${task.id}`, { headers })).json());
    const page = await app.firstWindow();
    await page.goto(`${base}/tasks/${task.id}`);
    const workbench = page.getByTestId('frontend-workbench');
    const previewState = async () => (await request.get(`${api}/tasks/${task.id}/preview`, { headers })).json();
    try {
      await expect.poll(async () => (await previewState()).state, { timeout: 45_000 }).toBe('running');
      await expect(workbench.getByTestId('preview-area')).toBeVisible();
    } catch (error) {
      throw new Error(JSON.stringify(await previewState()), { cause: error });
    }
    const nativeText = () =>
      app.evaluate(async ({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((item) => 'webContents' in item);
        const contents = (view as Electron.WebContentsView | undefined)?.webContents;
        return contents?.executeJavaScript("document.querySelector('#export')?.textContent");
      });
    await expect.poll(nativeText).toBe('导出');
    const pending = await detail();
    expect(pending.frontend?.verified).toBe(false);
    expect(pending.displayGroup).toBe('frontend_review');
    expect(pending.openInbox.filter((item) => item.kind === 'delivery')).toEqual([]);
    const earlyDelivery = await request.post(`${api}/tasks/${task.id}/deliver`, {
      headers,
      data: { strategy: 'squash' },
    });
    expect(earlyDelivery.status()).toBe(409);
    await workbench.getByRole('button', { name: '手机', exact: true }).click();

    async function round(number: number, label: string, rename: string) {
      await queue({ title: `界面修改 ${number}` }, [editPage(rename), submitResult(`第 ${number} 轮已修改`)]);
      await workbench.getByRole('button', { name: '标注修改', exact: true }).click();
      await expect(workbench.getByText('在页面上点击要修改的元素，按 Esc 退出点选。')).toBeVisible();
      const pickerReply = page.waitForResponse(
        (response) => response.url().endsWith('/pick-element') && response.request().postDataJSON()?.cancel !== true,
      );
      await app.evaluate(async ({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((item) => 'webContents' in item);
        const contents = (view as Electron.WebContentsView | undefined)?.webContents;
        if (contents === undefined) throw new Error('Preview is not placed');
        const point = await contents.executeJavaScript(`(() => {
          const r = document.querySelector('#export').getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        })()`);
        contents.focus();
        await contents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          button: 'left',
          clickCount: 1,
          ...point,
        });
        await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          button: 'left',
          clickCount: 1,
          ...point,
        });
      });
      const reply = await pickerReply;
      if (!reply.ok()) {
        const logs = join(dataDir, 'logs');
        const error = readdirSync(logs)
          .map((file) => readFileSync(join(logs, file), 'utf8'))
          .join('\n');
        await testInfo.attach('frontend-backend-errors', { body: error, contentType: 'text/plain' });
        throw new Error(`Picker HTTP ${reply.status()}: ${error.slice(-4000)}`);
      }
      expect(await reply.json()).toMatchObject({ element: { label, locator: '#export' } });
      await workbench.getByRole('textbox', { name: `修改「${label}」` }).fill(`把按钮改成「${rename}」`);
      if (number === 1) {
        await page.screenshot({ path: testInfo.outputPath('frontend-annotation-light.png'), animations: 'disabled' });
        await queue({ agent: 'aw-assistant' }, [
          { type: 'callTool', server: 'assistant', name: 'browser_read', args: {} },
          { type: 'text', text: '已检查订单页的手机布局。' },
        ]);
        await workbench.getByRole('button', { name: '让助手看看' }).click();
        await page.getByRole('textbox', { name: '发给助手的消息' }).fill('看看当前选中的导出按钮');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await expect(page.getByText('已检查订单页的手机布局。', { exact: true })).toBeVisible();
        const list = await (await request.get(`${api}/assistant/conversations`, { headers })).json();
        const messages = await (
          await request.get(`${api}/assistant/conversations/${list.items[0].id}/transcript`, { headers })
        ).json();
        const transcript = JSON.stringify(messages);
        expect(transcript).toContain('selectedElement');
        expect(transcript).toContain('#export');
        expect(transcript).toContain('scrollWidth');
        await page.getByRole('complementary', { name: '应用助手' }).getByRole('button', { name: '收起助手' }).click();
      }
      await workbench.getByRole('button', { name: '交给 AI 修改' }).click();
      await expect
        .poll(async () => {
          const current = await detail();
          return [current.status, current.frontend?.rounds.length];
        })
        .toEqual(['review', number]);
      const current = await detail();
      const last = current.frontend?.rounds.at(-1);
      if (last?.before == null) throw new Error('The round has no screenshot');
      expect(last.annotations[0]).toMatchObject({ element: { label, locator: '#export', viewport: 'mobile' } });
      expect(
        (await request.get(`${api}/tasks/${task.id}/browser/${last.before.file}`, { headers })).headers()[
          'content-type'
        ],
      ).toContain('image/jpeg');
      await workbench.getByRole('button', { name: '刷新', exact: true }).click();
      await expect.poll(nativeText).toBe(rename);
    }
    await round(1, '导出', '导出订单');
    await round(2, '导出订单', '下载订单');
    await expect(workbench.getByRole('button', { name: '手机', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(workbench.getByRole('button', { name: '界面修改 2' })).toBeVisible();
    const nativeImage = await app.evaluate(async ({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((item) => 'webContents' in item);
      const contents = (view as Electron.WebContentsView | undefined)?.webContents;
      if (contents === undefined) throw new Error('Preview is not placed');
      return (await contents.capturePage()).toPNG().toString('base64');
    });
    writeFileSync(testInfo.outputPath('frontend-native-page.png'), Buffer.from(nativeImage, 'base64'));
    await expect(await request.patch(`${api}/settings`, { headers, data: { 'ui.theme': 'default' } })).toBeOK();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
    await page.screenshot({ path: testInfo.outputPath('frontend-history-dark.png'), animations: 'disabled' });

    await queue({ title: '前端交付验收' }, [submitResult('构建与页面验收')]);
    await queue({ agent: 'aw-reviewer' }, [passReview]);
    await workbench.getByRole('button', { name: '完成并验收' }).click();
    await expect
      .poll(
        async () => {
          const current = await detail();
          return [current.status, current.frontend?.verified];
        },
        { timeout: 40_000 },
      )
      .toEqual(['review', true]);
    const accepted = await detail();
    expect(accepted.result?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'command',
          passed: true,
          command: nativeVue ? 'pnpm run build' : 'npm run build',
        }),
        expect.objectContaining({ kind: 'browser', passed: true }),
        expect.objectContaining({ kind: 'ai_review', passed: true }),
      ]),
    );
    expect(accepted.displayGroup).toBe('review');
    expect(accepted.openInbox.some((item) => item.kind === 'delivery')).toBe(true);
    await expect(workbench.getByText('已完成验收')).toBeVisible();

    // A stale tab from a different browser session cannot supply forged picks.
    const response = await request.post(`${api}/tasks/${task.id}/request-changes`, {
      headers,
      data: { reason: 'user', feedback: '坏关联', page: { tabId: 'foreign-tab' } },
    });
    expect(response.ok()).toBe(false);
    expect((await detail()).frontend?.verified).toBe(true);
  } finally {
    await app.close();
  }
});
