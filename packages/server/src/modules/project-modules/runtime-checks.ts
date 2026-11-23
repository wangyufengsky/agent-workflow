import { dirname, posix } from 'node:path';
import {
  AppError,
  ErrorCode,
  functionalTestMainClassSchema,
  type ProjectJavaModule,
  type ProjectModuleCheck,
} from '@aw/shared';
import { committedSources, javaBuildExecutable, type PreviewCommand, worktreeSources } from '../previews/index.ts';

export async function runtimeCheckCommands(
  worktree: { path: string; baseCommit: string },
  module: Pick<ProjectJavaModule, 'build' | 'directory'>,
  checks: readonly ProjectModuleCheck[],
  env: NodeJS.ProcessEnv,
  allowWorkingTreeChanges = false,
): Promise<PreviewCommand[]> {
  const { directory, build } = module;
  const invalid = () =>
    new AppError(ErrorCode.ValidationFailed, 'Choose a discovered Maven or Gradle test and an exact JUnit class');
  if (
    (build !== 'maven' && build !== 'gradle') ||
    (directory !== '.' && /[\\:\p{Cc}]/u.test(directory)) ||
    (directory !== '.' &&
      directory.split('/').some((part) => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))
  )
    throw invalid();
  const committed = committedSources(worktree.path, worktree.baseCommit);
  const files = allowWorkingTreeChanges ? worktreeSources(worktree.path) : committed;
  const manifest =
    build === 'maven'
      ? await files(posix.join(directory, 'pom.xml'), true)
      : ((await files(posix.join(directory, 'build.gradle'), false)) ??
        (await files(posix.join(directory, 'build.gradle.kts'), true)));
  if (manifest === undefined) throw invalid();
  const executable = await javaBuildExecutable(build, directory, committed, env);
  const commands: PreviewCommand[] = [];
  for (const check of checks) {
    const test = check.kind === `${build}-test`;
    const junit = check.kind === `${build}-junit`;
    const selected = check.testClass;
    if (
      (!test && !junit) ||
      (test && selected !== undefined) ||
      (junit && (!selected?.includes('.') || !functionalTestMainClassSchema.safeParse(selected).success))
    )
      throw invalid();
    if (selected !== undefined) {
      const testSource = posix.join(directory, 'src/test/java', `${selected.replaceAll('.', '/')}.java`);
      await files(testSource, true);
    }
    const args =
      build === 'maven'
        ? ['test', ...(selected === undefined ? [] : [`-Dtest=${selected}`])]
        : ['--no-daemon', 'test', ...(selected === undefined ? [] : ['--tests', selected])];
    commands.push({ executable, directory: dirname(manifest.absolute), args });
  }
  return commands;
}
