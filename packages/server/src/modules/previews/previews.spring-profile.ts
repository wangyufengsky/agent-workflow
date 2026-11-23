import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import { AppError, ErrorCode, type FunctionalTestLaunch } from '@aw/shared';
import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import { host } from '../../core/platform.ts';

const PROFILE_EXTENSIONS = ['yml', 'yaml', 'properties'];
const PROFILE_DIRECTORIES = ['src/main/resources', 'src/main/resources/config', '.', 'config'];
const PRODUCTION = /\bprod(?:uction)?\b/i;
const MAX_PROFILE_BYTES = 1024 * 1024;
type Source = (path: string, required: boolean) => Promise<{ absolute: string; size: number } | undefined>;
type ProfileSetting = readonly [key: string, values: string[]];

function names(value: unknown): string[] {
  if (isScalar(value)) return names(value.value);
  if (isSeq(value)) return value.items.flatMap(names);
  if (isAlias(value))
    throw new AppError(ErrorCode.ValidationFailed, 'A Spring profile cannot use an indirect YAML alias');
  if (typeof value === 'string')
    return value
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(names);
  return [];
}

function profileSettings(text: string, extension: string): ProfileSetting[] {
  if (extension === 'properties') {
    return [
      ...text.matchAll(
        /^\s*spring\.profiles\.(active|default|include|group\.[\w.-]+)(?:\[\d+\])?\s*[:=]\s*([^\r\n]*)/gm,
      ),
    ].map((match) => [match[1] ?? '', names(match[2])]);
  }
  const settings: ProfileSetting[] = [];
  for (const document of parseAllDocuments(text)) {
    if (document.errors.length > 0)
      throw new AppError(ErrorCode.ValidationFailed, 'The committed Spring profile YAML is invalid');
    for (const key of ['active', 'default', 'include']) {
      const value = document.getIn(['spring', 'profiles', key]) ?? document.get(`spring.profiles.${key}`);
      if (value !== undefined) settings.push([key, names(value)]);
    }
    const group = document.getIn(['spring', 'profiles', 'group'], true);
    if (isMap(group)) {
      for (const { key } of group.items) {
        if (isScalar(key) && typeof key.value === 'string')
          settings.push([`group.${key.value}`, names(document.getIn(['spring', 'profiles', 'group', key.value]))]);
      }
    }
    if (isMap(document.contents)) {
      for (const { key } of document.contents.items) {
        if (isScalar(key) && typeof key.value === 'string' && key.value.startsWith('spring.profiles.group.'))
          settings.push([key.value.slice('spring.profiles.'.length), names(document.get(key.value))]);
      }
    }
  }
  return settings;
}

export async function verifySpringProfile(
  { directory, profile }: FunctionalTestLaunch,
  committed: Source,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const definitions = new Map<string, string[]>();
  let declared = profile === undefined;
  for (const folder of PROFILE_DIRECTORIES) {
    for (const basename of profile === undefined ? ['application'] : ['application', `application-${profile}`]) {
      for (const extension of PROFILE_EXTENSIONS) {
        const path = posix.join(directory, folder, `${basename}.${extension}`);
        const file = await committed(path, false);
        if (file === undefined) continue;
        if (basename !== 'application') declared = true;
        if (file.size > MAX_PROFILE_BYTES)
          throw new AppError(ErrorCode.ValidationFailed, 'The committed Spring profile resource is too large', {
            path,
          });
        for (const [key, values] of profileSettings(await readFile(file.absolute, 'utf8'), extension)) {
          definitions.set(
            key,
            key === 'include' || key.startsWith('group.') ? [...(definitions.get(key) ?? []), ...values] : values,
          );
        }
      }
    }
  }
  if (!declared)
    throw new AppError(ErrorCode.ValidationFailed, 'The test profile needs a committed application profile resource', {
      directory,
      profile,
    });

  const active = names(host.envValue(env, 'SPRING_PROFILES_ACTIVE'));
  const defaults = names(host.envValue(env, 'SPRING_PROFILES_DEFAULT'));
  const effective =
    profile === undefined
      ? ([active, definitions.get('active'), defaults, definitions.get('default')].find(
          (items) => items && items.length > 0,
        ) ?? ['default'])
      : [profile];
  const pending = new Set([
    ...effective,
    ...names(host.envValue(env, 'SPRING_PROFILES_INCLUDE')),
    ...(definitions.get('include') ?? []),
  ]);
  for (const name of pending) {
    if (PRODUCTION.test(name)) {
      throw new AppError(
        ErrorCode.ValidationFailed,
        'The effective Spring configuration activates a production profile',
        {
          directory,
          ...(profile === undefined ? {} : { profile }),
        },
      );
    }
    for (const inherited of definitions.get(`group.${name}`) ?? []) pending.add(inherited);
    for (const inherited of names(host.envValue(env, `SPRING_PROFILES_GROUP_${name.toUpperCase()}`)))
      pending.add(inherited);
  }
}
