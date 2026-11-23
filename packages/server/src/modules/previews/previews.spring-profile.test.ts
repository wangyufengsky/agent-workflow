import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ErrorCode } from '@aw/shared';
import { expect, it } from 'vitest';
import { verifySpringProfile } from './previews.spring-profile.ts';

it('显式 QA 覆盖默认 prod，只拒绝有效 include 或 group 引入生产环境', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aw-spring-profiles-'));
  const files = new Map<string, string>();
  const source = async (relative: string) => {
    const absolute = files.get(relative);
    return absolute === undefined ? undefined : { absolute, size: (await stat(absolute)).size };
  };
  const write = async (relative: string, content: string) => {
    const absolute = join(root, relative);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content);
    files.set(relative, absolute);
  };
  const launch = { directory: 'api', source: 'api/pom.xml', script: 'spring-boot:run', readyPath: '/health' };
  const qa = { ...launch, profile: 'qa' as const };
  await write(
    'api/src/main/resources/application.properties',
    'spring.profiles.default=prod\nspring.profiles.group.prod=prod-db\n',
  );
  await write('api/config/application-qa.yml', 'fixture: true\n');
  await expect(verifySpringProfile(qa, source, {})).resolves.toBeUndefined();
  await expect(verifySpringProfile(launch, source, {})).rejects.toMatchObject({ code: ErrorCode.ValidationFailed });
  await write(
    'api/src/main/resources/config/application.yml',
    'spring:\n  profiles:\n    group:\n      qa: [shared]\n      shared: [prod-db]\n',
  );
  await expect(verifySpringProfile(qa, source, {})).rejects.toMatchObject({ code: ErrorCode.ValidationFailed });
  await write(
    'api/src/main/resources/config/application.yml',
    'spring:\n  profiles:\n    group:\n      prod: [prod-db]\n',
  );
  await write('api/src/main/resources/application.properties', 'spring.profiles.include[0]=prod-db\n');
  await expect(verifySpringProfile(qa, source, {})).rejects.toMatchObject({ code: ErrorCode.ValidationFailed });
});
