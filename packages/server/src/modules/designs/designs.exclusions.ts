import { posix } from 'node:path';

const NOISE = new Set(['.git', 'node_modules', 'dist', 'build', 'target', 'out', '.next', 'vendor', '__pycache__']);
const LOCK_FILES = new Set([
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'gemfile.lock',
  'uv.lock',
]);
const CREDENTIAL =
  /^(?:\.env(?:\..*)?|id_rsa.*|credentials\..*|\.npmrc|\.pypirc|\.ssh|\.aws|\.gnupg)$|\.(?:pem|key|p12|pfx)$|secret/i;
const ASSET =
  /\.(?:png|jpe?g|gif|ico|webp|avif|svg|mp[34]|mov|wav|ogg|mkv|zip|gz|tgz|7z|tar|rar|pdf|woff2?|ttf|otf|exe|dll|class|jar)$/i;

export function designExclusion(relPath: string, patterns: readonly string[]): string | undefined {
  const segments = relPath.split('/');
  if (segments.some((part) => part.toLowerCase() !== '.env.example' && CREDENTIAL.test(part))) return 'sensitive';
  if (segments.some((part) => NOISE.has(part))) return 'dependencyOrBuild';
  const name = posix.basename(relPath);
  if (LOCK_FILES.has(name.toLowerCase())) return 'lockfile';
  if (ASSET.test(name)) return 'asset';
  let candidate = '';
  for (const segment of segments) {
    candidate = posix.join(candidate, segment);
    if (
      patterns.some(
        (pattern) =>
          posix.matchesGlob(candidate, pattern) || (!pattern.includes('/') && posix.matchesGlob(segment, pattern)),
      )
    )
      return 'pattern';
  }
  return undefined;
}
