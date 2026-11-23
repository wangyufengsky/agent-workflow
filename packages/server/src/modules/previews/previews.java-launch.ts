import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, posix } from 'node:path';
import { AppError, ErrorCode, type FunctionalTestLaunch, functionalTestMainClassSchema } from '@aw/shared';
import { execa } from 'execa';
import { host } from '../../core/platform.ts';
import {
  type CommittedSource,
  javaBuildExecutable,
  type PreparePreviewCommand,
  type PreviewCommand,
} from './previews.commands.ts';
import { hasJavaMain, matchesJavaPackagePath } from './previews.java-source.ts';

const MAX_SOURCE = 1024 * 1024;
const BUILD_CLASSPATH = 'org.apache.maven.plugins:maven-dependency-plugin:3.8.1:build-classpath';
type JavaCommands = {
  manager: 'java' | 'maven' | 'gradle';
  javaVersion: number;
  javaEnv: NodeJS.ProcessEnv;
  command: (port: number) => PreviewCommand;
  prepare?: PreparePreviewCommand;
};

function invalid(message: string, details?: Record<string, unknown>): AppError {
  return new AppError(ErrorCode.ValidationFailed, message, details);
}

async function selectJdk(required: number | undefined, env: NodeJS.ProcessEnv) {
  const variables = [
    ...(required === undefined ? [] : [`JAVA${required}_HOME`, `JAVA_HOME_${required}_X64`]),
    'JAVA_HOME',
  ];
  const homes = variables.map((key) => host.envValue(env, key));
  if (required !== undefined) homes.push(await host.macRegisteredJavaHome(required, env));
  const candidates = new Set([
    ...homes.flatMap((home) => (home ? [host.findExecutable('java', [join(home, 'bin')])] : [])),
    ...host.pathDirs(env).map((directory) => host.findExecutable('java', [directory])),
  ]);
  for (const executable of candidates) {
    if (executable === undefined) continue;
    const version = await execa(executable, ['-XshowSettings:properties', '-version'], {
      env,
      extendEnv: false,
      reject: false,
      timeout: 5000,
    });
    if (version.exitCode !== 0) continue;
    const info = `${version.stdout}\n${version.stderr}`;
    const major = Number(/^\s*java\.version\s*=\s*(?:1\.)?(\d+)/m.exec(info)?.[1]);
    const reportedHome = /^\s*java\.home\s*=\s*(.+)$/m.exec(info)?.[1]?.trim();
    if (!Number.isInteger(major) || reportedHome === undefined || (required !== undefined && major !== required))
      continue;
    // JDK 8 reports the bundled JRE as java.home; builds need the JDK above it.
    const home =
      host.findExecutable('javac', [join(reportedHome, 'bin')]) === undefined ? dirname(reportedHome) : reportedHome;
    const java = host.findExecutable('java', [join(home, 'bin')]);
    const javac = host.findExecutable('javac', [join(home, 'bin')]);
    if (java === undefined || javac === undefined) continue;
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    return {
      java,
      major,
      env: { ...env, JAVA_HOME: home, [pathKey]: [join(home, 'bin'), ...host.pathDirs(env)].join(delimiter) },
    };
  }
  throw new AppError(ErrorCode.PreviewStartFailed, 'The requested Java JDK is not installed or on PATH', {
    ...(required === undefined ? {} : { javaVersion: required }),
  });
}

async function classpathFile(path: string): Promise<string[]> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_SOURCE) throw invalid('Invalid Maven dependency classpath output');
    return (await readFile(path, 'utf8')).trim().split(delimiter).filter(Boolean);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function serverProperties(port: number): string[] {
  return [`-Dserver.port=${port}`, '-Dserver.address=127.0.0.1'];
}

function mavenCommands(
  executable: string,
  java: string,
  directory: string,
  mainClass: string,
  includeProvided: boolean,
) {
  let classpath: string | undefined;
  return {
    prepare: async (run: (command: PreviewCommand) => Promise<void>) => {
      const scratch = await mkdtemp(join(tmpdir(), 'aw-java-classpath-'));
      try {
        const runtime = join(scratch, 'runtime.txt');
        await run({
          executable,
          args: ['compile', BUILD_CLASSPATH, '-DincludeScope=runtime', `-Dmdep.outputFile=${runtime}`],
        });
        const paths = await classpathFile(runtime);
        if (includeProvided) {
          const provided = join(scratch, 'provided.txt');
          await run({
            executable,
            args: [BUILD_CLASSPATH, '-DincludeScope=provided', `-Dmdep.outputFile=${provided}`],
          });
          paths.push(...(await classpathFile(provided)));
        }
        const classes = join(directory, 'target', 'classes');
        const compiled = `${join(classes, ...mainClass.split('.'))}.class`;
        const stat = await lstat(compiled).catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            throw new AppError(
              ErrorCode.PreviewStartFailed,
              'Maven did not produce the requested class under target/classes',
              { mainClass },
            );
          throw error;
        });
        if (!stat.isFile()) throw invalid('Maven did not produce a regular class file', { mainClass });
        classpath = [...new Set([classes, ...paths])].join(delimiter);
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
    command: (port: number) => {
      if (classpath === undefined) throw new Error('Maven runtime classpath has not been prepared');
      return { executable: java, args: [...serverProperties(port), '-cp', classpath, mainClass] };
    },
  };
}

// Run a backend-owned classpath task, never the project's potentially overridden application run task.
const GRADLE_CLASSPATH_TASK = 'awFunctionalTestClasspath';
const GRADLE_CLASSPATH_SCRIPT = `
gradle.beforeProject { project ->
    if (project.projectDir.canonicalFile != gradle.startParameter.currentDir.canonicalFile) return
    project.pluginManager.withPlugin("java") {
        def main = project.extensions.getByName("sourceSets").getByName("main")
        project.tasks.register("${GRADLE_CLASSPATH_TASK}") {
            dependsOn(main.classesTaskName)
            doLast {
                def output = new File(project.providers.gradleProperty("awFunctionalTestClasspathFile").get())
                output.setText(main.runtimeClasspath.asPath, "UTF-8")
                new File(output.parentFile, "classes.txt").setText(main.output.classesDirs.asPath, "UTF-8")
            }
        }
    }
}
`;

function gradleCommands(executable: string, java: string, mainClass: string) {
  let classpath: string | undefined;
  return {
    prepare: async (run: (command: PreviewCommand) => Promise<void>) => {
      const scratch = await mkdtemp(join(tmpdir(), 'aw-java-classpath-'));
      try {
        const init = join(scratch, 'classpath.gradle');
        const output = join(scratch, 'classpath.txt');
        await writeFile(init, GRADLE_CLASSPATH_SCRIPT, { encoding: 'utf8', flag: 'wx' });
        await run({
          executable,
          args: [
            '--no-daemon',
            '--no-configuration-cache',
            '--init-script',
            init,
            `-PawFunctionalTestClasspathFile=${output}`,
            GRADLE_CLASSPATH_TASK,
          ],
        });
        const classes = await classpathFile(join(scratch, 'classes.txt'));
        const compiledPath = `${join(...mainClass.split('.'))}.class`;
        for (const directory of classes) {
          const compiled = await lstat(join(directory, compiledPath)).catch(() => undefined);
          if (compiled?.isFile()) {
            classpath = [...new Set([directory, ...(await classpathFile(output))])].join(delimiter);
            return;
          }
        }
        throw invalid('Gradle did not compile the requested class in the selected module main source set', {
          mainClass,
        });
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
    command: (port: number) => {
      if (classpath === undefined) throw new Error('Gradle runtime classpath has not been prepared');
      return { executable: java, args: [...serverProperties(port), '-cp', classpath, mainClass] };
    },
  };
}

export async function javaCommands(
  launch: FunctionalTestLaunch,
  manifest: string,
  sourcePath: string,
  committed: CommittedSource,
  env: NodeJS.ProcessEnv,
): Promise<JavaCommands> {
  const { source, directory, mainClass, javaVersion, includeProvided } = launch;
  if (
    mainClass === undefined ||
    !functionalTestMainClassSchema.safeParse(mainClass).success ||
    launch.profile !== undefined
  )
    throw invalid('Java main launch requires a class name and does not accept a Spring profile');
  const basename = posix.basename(source);
  const direct = basename.endsWith('.java');
  const maven = basename === 'pom.xml';
  const gradle = /^build\.gradle(?:\.kts)?$/.test(basename);
  if (!direct && !maven && !gradle) throw invalid('Choose a Java source, Maven POM or Gradle build file', { source });
  if (includeProvided && !maven) throw invalid('Provided dependencies can be included only by the Maven Java launcher');

  const mainSource = direct ? source : posix.join(directory, 'src/main/java', `${mainClass.replaceAll('.', '/')}.java`);
  const file = direct ? undefined : await committed(mainSource, true);
  if (file !== undefined && file.size > MAX_SOURCE)
    throw invalid('The committed Java main source is too large', { source: mainSource });
  if (!hasJavaMain(file === undefined ? manifest : await readFile(file.absolute, 'utf8'), mainClass, direct))
    throw invalid('The committed selected class does not declare public static void main(String[])', {
      source: mainSource,
      mainClass,
    });

  const jdk = await selectJdk(javaVersion, env);
  const runtime = { javaVersion: jdk.major, javaEnv: jdk.env };
  if (direct) {
    if (jdk.major < 11)
      throw invalid('Standalone Java source-file launch requires JDK 11 or newer', { javaVersion: jdk.major });
    if (!matchesJavaPackagePath(source, mainClass, jdk.major))
      throw invalid('Standalone Java source must be in a directory matching its package on JDK 22 or newer', {
        source,
        mainClass,
        javaVersion: jdk.major,
      });
    return {
      ...runtime,
      manager: 'java',
      command: (port) => ({ executable: jdk.java, args: [...serverProperties(port), sourcePath] }),
    };
  }
  if (gradle) {
    const executable = await javaBuildExecutable('gradle', directory, committed, jdk.env);
    return { ...runtime, manager: 'gradle', ...gradleCommands(executable, jdk.java, mainClass) };
  }
  const executable = await javaBuildExecutable('maven', directory, committed, jdk.env);
  return {
    ...runtime,
    manager: 'maven',
    ...mavenCommands(executable, jdk.java, dirname(sourcePath), mainClass, includeProvided === true),
  };
}
