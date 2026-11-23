import { functionalTestMainClassSchema, type IdeConfiguration } from '@aw/shared';
import { SaxesParser } from 'saxes';

type Attributes = Record<string, string>;
export function visitIdeaXml(xml: string, visit: (path: string, attrs: Attributes) => void) {
  const parser = new SaxesParser();
  const path: string[] = [];
  parser.on('doctype', () => {
    throw new Error('Unsupported IDEA XML doctype');
  });
  parser.on('opentag', ({ name, attributes }) => {
    if (path.length >= 64) throw new Error('IDEA XML nesting limit');
    path.push(name);
    visit(path.join('/'), attributes);
  });
  parser.on('closetag', () => path.pop());
  parser.write(xml).close();
}

/** Only return project-relative IDEA paths. SDK paths, environment and arguments stay local. */
export function projectPath(value: string) {
  const match = /^\$PROJECT_DIR\$(?:\/(.+))?$/.exec(value);
  if (!match) return undefined;
  if (!match[1]) return '.';
  return match[1].split('/').every((part) => /^[\p{L}\p{N} _.-]+$/u.test(part) && part !== '..' && part !== '.')
    ? match[1]
    : undefined;
}

function javaMajor(name: string) {
  const match =
    /^(?:(?:java|jdk|openjdk|temurin|corretto|zulu|graalvm|liberica|ms|oracle|semeru)[ _-]*)?(?:1\.)?(\d{1,2})(?:[. +_-].*)?$/i.exec(
      name,
    );
  return match && Number(match[1]) >= 8 ? Number(match[1]) : undefined;
}

export function parseIdeaConfigurations(
  xml: string,
  source: string,
  location: IdeConfiguration['location'],
  projectSdk: string | undefined,
  moduleSdks: ReadonlyMap<string, string>,
) {
  const configurations: IdeConfiguration[] = [];
  const local = source === '.idea/workspace.xml';
  const component = local ? 'project/component' : 'component';
  const entry = `${component}/configuration`;
  let owner = false;
  let current: IdeConfiguration | undefined;
  let sdk: string | undefined;
  let useSdk = false;
  const complete = () => {
    if (!current?.mainClass) return;
    const name = useSdk ? sdk : (moduleSdks.get(current.module ?? '') ?? projectSdk);
    if (name || useSdk) {
      const major = javaMajor(name ?? '');
      if (major) current.javaVersion = major;
      else current.review.push('unresolved JDK');
    }
    current.review = [...new Set(current.review)];
    configurations.push(current);
  };
  visitIdeaXml(xml, (path, a) => {
    if (path === component) {
      complete();
      current = undefined;
      owner = a.name === (local ? 'RunManager' : 'ProjectRunConfigurationManager');
    }
    if (!owner) return;
    if (path === entry) {
      complete();
      current = undefined;
      sdk = undefined;
      useSdk = false;
      if (
        a.default === 'true' ||
        !a.name ||
        (a.type !== 'Application' && a.type !== 'SpringBootApplicationConfigurationType')
      )
        return;
      current = {
        name: a.name.slice(0, 160),
        type: a.type,
        source,
        location,
        mainClass: '',
        includeProvided: a.type === 'SpringBootApplicationConfigurationType',
        review: [],
      };
      if (a['target-name']) current.review.push('execution target');
      return;
    }
    if (!current) return;
    if (path === `${entry}/module`) current.module = a.name?.slice(0, 200);
    if ([`${entry}/envs/env`, `${entry}/envFiles/envFile`, `${entry}/envFilePaths/option`].includes(path))
      current.review.push('environment variables or files');
    if (path === `${entry}/method/option` && a.enabled !== 'false' && a.name !== 'Make')
      current.review.push('before-launch task');
    if (path !== `${entry}/option`) return;
    const value = a.value?.trim();
    if (!value) return;
    switch (a.name) {
      case 'MAIN_CLASS_NAME':
      case 'MAIN_CLASS':
      case 'SPRING_BOOT_MAIN_CLASS':
        if (functionalTestMainClassSchema.safeParse(value).success) current.mainClass = value;
        break;
      case 'INCLUDE_PROVIDED_SCOPE':
        current.includeProvided = value === 'true';
        break;
      case 'ALTERNATIVE_JRE_PATH':
        sdk = value;
        break;
      case 'ALTERNATIVE_JRE_PATH_ENABLED':
        useSdk = value === 'true';
        break;
      case 'ACTIVE_PROFILES':
        if (value === 'qa' || value === 'test') current.profile = value;
        else current.review.push('active profiles');
        break;
      case 'PASS_PARENT_ENVS':
        if (value === 'false') current.review.push('isolated process environment');
        break;
      case 'WORKING_DIRECTORY':
        current.directory = projectPath(value);
        if (!current.directory) current.review.push('working directory');
        break;
      case 'VM_PARAMETERS':
      case 'PROGRAM_PARAMETERS':
      case 'ENV_FILE_PATHS':
      case 'TARGET_NAME':
      case 'remoteTarget':
      case 'REDIRECT_INPUT_PATH':
        current.review.push(a.name);
        break;
    }
  });
  complete();
  return configurations;
}
