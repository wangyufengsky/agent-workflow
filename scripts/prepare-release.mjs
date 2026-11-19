import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const [tag, runId] = process.argv.slice(2);
const repo = process.env.GH_REPO;
if (!repo || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag) || !/^\d+$/.test(runId)) {
  throw new Error('Expected GH_REPO, a version tag (vX.Y.Z), and a numeric CI run ID');
}

const endpoint = `repos/${repo}`;
const version = tag.slice(1);
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const api = (path) => JSON.parse(gh('api', `${endpoint}/${path}`));

function findRelease() {
  const releases = gh('api', `${endpoint}/releases?per_page=100`, '--paginate', '--jq', '.[] | {id,tag_name,draft}');
  return releases
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((release) => release.tag_name === tag);
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function stagedAssets(directory) {
  const platformFiles = {
    'macos-arm64': [`agent-workflow-${version}-arm64.dmg`],
    'windows-2022': [`agent-workflow-${version}-setup-x64.exe`],
    'ubuntu-24.04': [`agent-workflow-${version}-x86_64.AppImage`, `agent-workflow_${version}_amd64.deb`],
    'ubuntu-24.04-arm': [`agent-workflow-${version}-arm64.AppImage`, `agent-workflow_${version}_arm64.deb`],
  };
  const paths = Object.entries(platformFiles).flatMap(([platform, names]) =>
    names.map((name) => join(directory, `installers-${platform}`, name)),
  );
  const assets = [];
  for (const path of paths) {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size === 0) throw new Error(`Expected a nonempty installer: ${path}`);
    assets.push({ name: basename(path), path, digest: await sha256(path) });
  }
  assets.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const name = 'SHA256SUMS.txt';
  const path = join(directory, name);
  await writeFile(path, assets.map((asset) => `${asset.digest}  ${asset.name}\n`).join(''));
  return [...assets, { name, path, digest: await sha256(path) }];
}

function missingAssets(release, staged) {
  const assets = new Map(api(`releases/${release.id}/assets?per_page=100`).map((asset) => [asset.name, asset]));
  return staged.filter(({ name, digest }) => {
    const existing = assets.get(name);
    if (!existing) return true;
    if (existing.state !== 'uploaded' || existing.digest !== `sha256:${digest}`) {
      throw new Error(`Draft asset differs from CI: ${name}`);
    }
    return false;
  });
}

const commit = api(`commits/${tag}`).sha;
const run = api(`actions/runs/${runId}`);
if (
  run.path !== '.github/workflows/ci.yml' ||
  run.event !== 'workflow_dispatch' ||
  run.status !== 'completed' ||
  run.conclusion !== 'success' ||
  run.head_repository?.full_name !== repo
) {
  throw new Error('Expected a successful manual CI run in this repository');
}
if (run.head_sha !== commit) throw new Error('The CI commit must match the tag commit');
const manifest = api(`contents/apps/desktop/package.json?ref=${commit}`);
if (JSON.parse(Buffer.from(manifest.content, 'base64').toString('utf8')).version !== version) {
  throw new Error('The desktop package version must match the tag');
}

const existing = findRelease();
if (existing && !existing.draft) throw new Error(`Release ${tag} is already published`);

const temporary = await mkdtemp(join(tmpdir(), 'aw-release-'));
try {
  // 上传使用下载来的文件路径，GitHub 按文件名保存附件。
  gh('run', 'download', runId, '--pattern', 'installers-*', '--dir', temporary);
  const staged = await stagedAssets(temporary);
  if (!existing) {
    const flags = process.env.RELEASE_PRERELEASE === 'true' ? ['--prerelease'] : [];
    gh('release', 'create', tag, '--draft', '--verify-tag', '--title', tag, '--generate-notes', ...flags);
  }
  const draft = findRelease();
  if (!draft?.draft) throw new Error(`Expected a draft release for ${tag}`);
  const missing = missingAssets(draft, staged);
  if (missing.length) gh('release', 'upload', tag, ...missing.map(({ path }) => path));
  if (missingAssets(draft, staged).length) throw new Error('GitHub did not return all verified release assets');
  console.log(`Verified draft: https://github.com/${repo}/releases/tag/${tag}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
