import { posix } from 'node:path';
import { AppError, ErrorCode, Platform } from '@aw/shared';
import { host } from '../../core/platform.ts';

export type PreviewCommand = { executable: string; args: string[]; directory?: string };
export type CommittedSource = (
  relative: string,
  required: boolean,
) => Promise<{ absolute: string; size: number } | undefined>;
export type PreparePreviewCommand = (run: (command: PreviewCommand) => Promise<void>) => Promise<void>;

export function findManager(manager: string, env: NodeJS.ProcessEnv): string {
  const executable = host.findExecutable(manager, host.pathDirs(env));
  if (executable === undefined)
    throw new AppError(ErrorCode.PreviewStartFailed, 'The project launcher is not installed', { manager });
  return executable;
}

export async function javaBuildExecutable(
  tool: 'maven' | 'gradle',
  directory: string,
  committed: CommittedSource,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const windows = host.os === Platform.Win32;
  const wrapper = tool === 'maven' ? (windows ? 'mvnw.cmd' : 'mvnw') : windows ? 'gradlew.bat' : 'gradlew';
  let folder = directory;
  while (true) {
    const relative = posix.join(folder, wrapper);
    const local = await committed(relative, false);
    if (local !== undefined) {
      if (!host.isExecutableFile(local.absolute))
        throw new AppError(ErrorCode.PreviewStartFailed, 'The committed launcher wrapper is not executable', {
          wrapper: relative,
        });
      return local.absolute;
    }
    if (folder === '.') return findManager(tool === 'maven' ? 'mvn' : 'gradle', env);
    folder = posix.dirname(folder);
  }
}
