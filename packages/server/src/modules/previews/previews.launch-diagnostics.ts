import { delimiter } from 'node:path';
import type { FunctionalTestLaunch, FunctionalTestLaunchDiagnostics } from '@aw/shared';
import type { PreviewCommand } from './previews.commands.ts';
import type { ResolvedTestLaunch } from './previews.test-launch.ts';

export function launchDiagnostics(
  config: ResolvedTestLaunch,
  proposal: FunctionalTestLaunch,
  args: PreviewCommand['args'],
  options: { beforeRun: readonly string[]; injectedEnvironment?: readonly string[] },
): FunctionalTestLaunchDiagnostics {
  const pathIndex = args.indexOf('-cp');
  const classpath = pathIndex < 0 ? undefined : args[pathIndex + 1];
  const { directory, manager, javaVersion, includeProvided, script } = config.evidence;
  return {
    workingDirectory: directory,
    manager,
    ...(javaVersion === undefined ? {} : { javaVersion }),
    ...(includeProvided === undefined ? {} : { includeProvided }),
    ...(classpath === undefined ? {} : { classpathEntries: classpath.split(delimiter).length }),
    managedVmOptions: args.flatMap((arg) => {
      const managed = /^-D(server\.port|server\.address)=/.exec(arg)?.[1];
      return managed === undefined ? [] : [managed];
    }),
    beforeRun: [
      ...options.beforeRun,
      ...(args.length > 0 && (script === 'bootRun' || script === 'spring-boot:run') ? ['launcher_managed'] : []),
    ],
    injectedEnvironment: [...(options.injectedEnvironment ?? [])],
    requested: {
      workingDirectory: proposal.directory,
      ...(proposal.javaVersion === undefined ? {} : { javaVersion: proposal.javaVersion }),
      ...(proposal.includeProvided === undefined ? {} : { includeProvided: proposal.includeProvided }),
    },
  };
}
