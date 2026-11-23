import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PROJECT_MODULE_CHECK_LIMIT } from '@aw/shared';
import { type APIRequestContext, expect, test } from '@playwright/test';
import { API_BASE, AUTH } from './env.ts';
import { createProject, git, patchSettings, TASK_RUN_TIMEOUT_MS } from './helpers.ts';

const service = `package demo;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

public class QuoteService {
  public static void main(String[] args) throws Exception {
    int port = Integer.parseInt(System.getProperty("server.port"));
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
    server.createContext("/health", exchange -> {
      byte[] body = "online".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(200, body.length);
      exchange.getResponseBody().write(body);
      exchange.close();
    });
    server.start();
    System.out.println("Quote service listening on " + port);
  }
}
`;
const config = (name: string, javaVersion?: number) =>
  `<configuration name="${name}" type="Application">
    <option name="MAIN_CLASS_NAME" value="demo.QuoteService"/>
    <option name="WORKING_DIRECTORY" value="$PROJECT_DIR$/quote-service/demo"/>
    ${
      javaVersion === undefined
        ? ''
        : `<option name="ALTERNATIVE_JRE_PATH_ENABLED" value="true"/>
    <option name="ALTERNATIVE_JRE_PATH" value="jdk-${javaVersion}"/>`
    }
  </configuration>`;

async function moduleFixture(request: APIRequestContext, javaVersion?: number, ledgerClasses = 1) {
  const project = await createProject(request, null);
  const files: Record<string, string> = {
    'quote-service/demo/QuoteService.java': service,
    'quote-service/demo/README.md': 'Ready path: /health',
    'settlement/SettlementJob.java':
      'public class SettlementJob implements CommandLineRunner { public static void main(String[] args) {} } interface CommandLineRunner {}',
    'ledger/pom.xml':
      '<project><groupId>demo</groupId><artifactId>ledger</artifactId><dependencies><dependency><artifactId>junit-jupiter</artifactId></dependency></dependencies></project>',
    'billing/pom.xml':
      '<project><groupId>demo</groupId><artifactId>billing</artifactId><dependencies><dependency><groupId>demo</groupId><artifactId>ledger</artifactId></dependency></dependencies></project>',
    'billing/src/main/java/demo/Billing.java': 'package demo; public class Billing {}',
    'ledger/src/main/java/demo/Ledger.java': 'package demo; public class Ledger {}',
    'ledger/src/test/java/demo/LedgerTest.java':
      'package demo; import org.junit.jupiter.api.Test; class LedgerTest { @Test void sums() {} }',
    '.run/Team.run.xml': `<component name="ProjectRunConfigurationManager">${config('团队共享配置', javaVersion)}</component>`,
  };
  for (let i = 1; i < ledgerClasses; i += 1) {
    files[`ledger/src/test/java/demo/Ledger${i}Test.java`] =
      `package demo; import org.junit.jupiter.api.Test; class Ledger${i}Test { @Test void sums() {} }`;
  }
  for (const [name, body] of Object.entries(files)) {
    const destination = join(project.repoPath, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, body);
  }
  git(project.repoPath, 'add', '-A');
  git(project.repoPath, 'commit', '-m', 'Add synthetic project modules');
  async function localConfig(version?: number) {
    const destination = join(project.repoPath, '.idea/workspace.xml');
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(
      destination,
      `<project><component name="RunManager">${config('开发机配置', version)}</component></project>`,
    );
  }
  await localConfig(javaVersion);
  await expect(
    await request.patch(`${API_BASE}/projects/${project.id}`, { headers: AUTH, data: { name: '订单与账务示例' } }),
  ).toBeOK();
  return { project, localConfig };
}

test('项目模块支持搜索、切换启动配置和选择模块检查', async ({ page, request }) => {
  const { project } = await moduleFixture(request, undefined, PROJECT_MODULE_CHECK_LIMIT);
  await page.goto(`/projects/${project.id}`);
  const panel = page.getByRole('region', { name: '模块与运行配置' });
  const list = panel.getByRole('complementary', { name: '项目模块' });
  await expect(list.getByRole('button', { name: /demo.QuoteService/ })).toBeVisible();
  await expect(list.getByRole('button', { name: /SettlementJob/ })).toBeVisible();
  const search = panel.getByRole('searchbox', { name: '搜索模块' });
  await search.fill('不存在');
  await expect(panel.getByText('没有匹配的模块。')).toBeVisible();
  await search.fill('quote');
  await expect(list.getByRole('button')).toHaveCount(1);
  const choices = panel.getByRole('combobox', { name: '模块启动配置' });
  await choices.selectOption({ label: '开发机配置' });
  await expect(panel.getByText('.idea/workspace.xml', { exact: true })).toBeVisible();
  await expect(panel.getByText('仅本机', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '重新发现' }).click();
  await expect(choices.locator('option:checked')).toHaveText('开发机配置');
  await expect(panel.getByRole('button', { name: '设为模块默认' })).toHaveCount(0);
  const testLink = panel.getByRole('link', { name: '发起功能测试' });
  const href = await testLink.getAttribute('href');
  if (href === null) throw new Error('Functional test link unavailable');
  const launchSearch = new URL(href, page.url()).searchParams;
  expect(launchSearch.get('projectId')).toBe(project.id);
  expect(launchSearch.get('moduleId')).toContain('quote-service/demo/QuoteService.java');
  expect(launchSearch.get('configurationId')).toContain('开发机配置');
  expect(launchSearch.get('configurationFingerprint')).toMatch(/^[a-f0-9]{64}$/);

  await search.fill('');
  await list.getByRole('button', { name: /ledger/ }).click();
  await panel.getByRole('button', { name: '查看模块检查' }).click();
  const checks = panel.getByRole('tabpanel', { name: /模块检查/ });
  const run = panel.getByRole('button', { name: '运行所选检查' });
  await expect(run).toBeEnabled();
  const suite = checks.getByRole('checkbox', { name: /All tests/ });
  const individual = checks.getByRole('checkbox', { name: /LedgerTest/ });
  const selected = checks.getByRole('checkbox', { checked: true });
  await expect(checks.getByRole('checkbox')).toHaveCount(PROJECT_MODULE_CHECK_LIMIT + 1);
  await expect(selected).toHaveCount(1);
  await expect(suite).toBeChecked();
  await individual.check();
  await expect(suite).not.toBeChecked();
  await expect(selected).toHaveCount(1);
  await expect(run).toBeEnabled();
  await suite.check();
  await expect(individual).not.toBeChecked();
  await expect(selected).toHaveCount(1);
  await suite.uncheck();
  await expect(run).toBeDisabled();
  await expect(panel.getByRole('link', { name: '发起功能测试' })).toHaveCount(0);
  const dependents = checks.getByRole('region', { name: '建议追加验证的模块' });
  await dependents.getByRole('button', { name: '查看 billing 的模块检查' }).click();
  await expect(panel.getByRole('heading', { name: 'billing', exact: true })).toBeVisible();
  await expect(panel.getByRole('tab', { name: /模块检查/ })).toHaveAttribute('aria-selected', 'true');
});

test('真实服务试启动、记录、停机及模块默认配置', async ({ page, request }) => {
  const probe = spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 5000 });
  const version = Number(/version "(?:1\.)?(\d+)/.exec(probe.stderr ?? '')?.[1]);
  test.skip(
    probe.status !== 0 || !Number.isInteger(version) || version < 11,
    'JDK 11+ required for the real standalone service',
  );
  const { project, localConfig } = await moduleFixture(request, version);
  await patchSettings(request, { 'ui.theme': 'codex' });
  await page.goto(`/projects/${project.id}`);
  const panel = page.getByRole('region', { name: '模块与运行配置' });
  await panel.getByRole('button', { name: /demo.QuoteService/ }).click();
  await panel.getByRole('combobox', { name: '模块启动配置' }).selectOption({ label: '开发机配置' });
  try {
    await panel.getByRole('button', { name: '试启动', exact: true }).click();
    const records = panel.getByRole('tabpanel', { name: '运行记录' });
    await expect(records.getByText('GET /health → HTTP 200')).toBeVisible({ timeout: 3 * TASK_RUN_TIMEOUT_MS });
    await expect(records.getByText(/Quote service listening on/)).toBeVisible();
    const address = await records.getByText(/^http:\/\/127\.0\.0\.1:\d+\/health$/).textContent();
    if (address === null) throw new Error('Module health URL unavailable');
    expect(await (await request.get(address)).text()).toBe('online');
    await panel.getByRole('button', { name: '停止试启动', exact: true }).click();
    await expect(records.getByText('已停止', { exact: true })).toBeVisible();
    await panel.getByRole('tab', { name: '运行配置' }).click();
    await expect(panel.getByText('就绪检查通过')).toBeVisible();
    await panel.getByRole('button', { name: '设为模块默认' }).click();
    await expect(panel.getByText('模块默认', { exact: true })).toBeVisible();
    await page.reload();
    const choices = panel.getByRole('combobox', { name: '模块启动配置' });
    await expect(choices.locator('option:checked')).toHaveText('开发机配置');
    const screenshots = process.env.AW_PROJECT_MODULE_SCREENSHOTS;
    if (screenshots !== undefined) {
      await panel.screenshot({ path: join(screenshots, 'module-config-light.png'), animations: 'disabled' });
      await patchSettings(request, { 'ui.theme': 'default' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'default');
      await panel.getByRole('tab', { name: '运行记录' }).click();
      await panel.screenshot({ path: join(screenshots, 'module-logs-dark.png'), animations: 'disabled' });
    }
    await localConfig(version + 1);
    await panel.getByRole('button', { name: '重新发现' }).click();
    await expect(panel.locator('article').getByText('待重新验证', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '设为模块默认' })).toHaveCount(0);
  } finally {
    const stop = panel.getByRole('button', { name: '停止试启动', exact: true });
    if (await stop.isVisible()) await stop.click();
    await patchSettings(request, { 'ui.theme': 'codex' });
  }
});
