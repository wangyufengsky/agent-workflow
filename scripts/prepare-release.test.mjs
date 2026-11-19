import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./prepare-release.mjs', import.meta.url));

function fixture(t, scenario) {
  const root = mkdtempSync(join(tmpdir(), 'aw-release-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tmp = join(root, 'tmp');
  const log = join(root, 'calls');
  mkdirSync(tmp);
  const gh = join(root, 'gh');
  writeFileSync(
    gh,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const cwd = process.cwd();
const scenario = process.env.SCENARIO;
const state = process.env.GH_LOG + '.assets';
const draft = process.env.GH_LOG + '.draft';
const entries = fs.existsSync(state) ? JSON.parse(fs.readFileSync(state, 'utf8')) : [];
fs.appendFileSync(process.env.GH_LOG, JSON.stringify(args) + '\\n');
function print(value) { console.log(JSON.stringify(value)); }
if (args[0] === 'api') {
  if (args[1].endsWith('/commits/v1.2.3')) print({ sha: 'commit' });
  else if (args[1].includes('/contents/')) print({ content: Buffer.from('{"version":"1.2.3"}').toString('base64') });
  else if (args[1].endsWith('/actions/runs/42')) {
    print({ path: '.github/workflows/ci.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
      head_sha: scenario === 'wrong-commit' ? 'different' : 'commit', head_repository: { full_name: 'owner/repo' } });
  } else if (args[1].includes('/releases?')) {
    if (fs.existsSync(draft) || scenario === 'published') print({ id: 7, tag_name: 'v1.2.3', draft: scenario !== 'published' });
  } else if (args[1].includes('/releases/7/assets')) print(entries);
  else process.exit(99);
} else if (args[0] === 'run') {
  for (const [platform, names] of Object.entries({
    'macos-arm64': ['agent-workflow-1.2.3-arm64.dmg'],
    'windows-2022': ['agent-workflow-1.2.3-setup-x64.exe'],
    'ubuntu-24.04': ['agent-workflow-1.2.3-x86_64.AppImage','agent-workflow_1.2.3_amd64.deb'],
    'ubuntu-24.04-arm': ['agent-workflow-1.2.3-arm64.AppImage','agent-workflow_1.2.3_arm64.deb'],
  })) {
    const folder = path.join(args.at(-1), 'installers-' + platform);
    fs.mkdirSync(folder);
    for (const name of names) {
      if (scenario !== 'missing-asset' || !name.endsWith('.dmg')) fs.writeFileSync(path.join(folder, name), name);
    }
  }
} else if (args[1] === 'upload') {
  const assets = args.slice(3);
  for (const filename of assets) {
    const name = path.basename(filename);
    const digest = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(cwd, filename))).digest('hex');
    entries.push({ name, digest: 'sha256:' + digest, state: 'uploaded' });
    if (scenario === 'interrupted-upload') {
      fs.writeFileSync(state, JSON.stringify(entries));
      process.exit(1);
    }
  }
  fs.writeFileSync(state, JSON.stringify(entries));
} else if (args[1] === 'create') fs.writeFileSync(draft, '');
else process.exit(98);
`,
  );
  chmodSync(gh, 0o755);
  const env = {
    ...process.env,
    GH_REPO: 'owner/repo',
    GH_LOG: log,
    SCENARIO: scenario,
    TMPDIR: tmp,
    PATH: root + delimiter + process.env.PATH,
  };
  const run = (nextScenario = scenario) =>
    spawnSync(process.execPath, [script, 'v1.2.3', '42'], {
      env: { ...env, SCENARIO: nextScenario },
      encoding: 'utf8',
    });
  const calls = () => readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  return { run, calls, tmp };
}

test('校验并上传同一份安装包，成功或重跑后回收暂存目录', (t) => {
  const { run, calls, tmp } = fixture(t, 'success');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const commands = calls();
  assert.ok(
    commands.some(([kind, action, ...args]) => kind === 'release' && action === 'create' && args.includes('--draft')),
  );
  const download = commands.find(([kind]) => kind === 'run').at(-1);
  const upload = commands.find(([kind, action]) => kind === 'release' && action === 'upload');
  assert.equal(upload.slice(3).length, 7);
  assert.ok(upload.slice(3).every((asset) => asset.startsWith(`${download}/`)));
  const again = run();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(calls().filter(([kind]) => kind === 'release').length, 2);
  assert.deepEqual(readdirSync(tmp), []);
});

test('上传中断后保留已验证附件，下一次补齐其余附件', (t) => {
  const { run, calls, tmp } = fixture(t, 'interrupted-upload');
  assert.notEqual(run().status, 0);
  assert.deepEqual(readdirSync(tmp), []);
  const resumed = run('success');
  assert.equal(resumed.status, 0, resumed.stderr);
  const resumedUpload = calls()
    .filter(([kind, action]) => kind === 'release' && action === 'upload')
    .at(-1);
  assert.equal(resumedUpload.slice(3).length, 6);
  assert.deepEqual(readdirSync(tmp), []);
});

for (const [scenario, message] of [
  ['wrong-commit', /tag commit/],
  ['missing-asset', /arm64\.dmg/],
  ['published', /already published/],
]) {
  test(`拒绝 ${scenario}，避免创建或覆盖发布并回收暂存目录`, (t) => {
    const { run, calls, tmp } = fixture(t, scenario);
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.ok(calls().every(([kind]) => kind !== 'release'));
    assert.deepEqual(readdirSync(tmp), []);
  });
}
