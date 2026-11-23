import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { IdeConfiguration } from '@aw/shared';
import { parseIdeaConfigurations, projectPath, visitIdeaXml } from './functional-tests.idea-xml.ts';

const XML_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 96;
const MAX_CONFIGS = 128;

function missing(error: unknown) {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function reader(root: string, location: IdeConfiguration['location'], warnings: Set<string>) {
  let remaining = XML_BYTES * 3;
  async function checked(path: string) {
    const absolute = join(root, path);
    if ((await realpath(absolute)) !== absolute) throw new Error('Linked IDEA path');
    return absolute;
  }
  async function xml(path: string, parse: (data: string) => void) {
    try {
      const absolute = await checked(path);
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.size > Math.min(remaining, XML_BYTES)) throw new Error('IDEA XML limit');
      const file = await open(absolute, 'r');
      try {
        const opened = await file.stat();
        if (opened.dev !== stat.dev || opened.ino !== stat.ino || (await checked(path)) !== absolute)
          throw new Error('IDEA path changed');
        const data = Buffer.alloc(stat.size + 1);
        let offset = 0;
        while (offset < data.length) {
          const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        if (offset !== stat.size) throw new Error('IDEA XML changed');
        remaining -= offset;
        parse(data.toString('utf8', 0, offset));
      } finally {
        await file.close();
      }
    } catch (error) {
      if (!missing(error)) warnings.add(`${location}/${path}: could not inspect configuration`);
    }
  }
  async function configs(dir: string, suffix: string) {
    const files: string[] = [];
    try {
      for await (const entry of await opendir(await checked(dir))) {
        if (!entry.isFile() || !entry.name.endsWith(suffix)) continue;
        if (files.length >= MAX_FILES) {
          warnings.add(`${location}/${dir}: configuration limit reached`);
          break;
        }
        files.push(`${dir}/${entry.name}`);
      }
    } catch (error) {
      if (!missing(error)) warnings.add(`${location}/${dir}: could not list configurations`);
    }
    return files.sort();
  }
  return { xml, configs, location };
}

async function sdkSettings(files: ReturnType<typeof reader>) {
  let project: string | undefined;
  const modules = new Map<string, string>();
  const paths = new Set<string>();
  await files.xml('.idea/misc.xml', (xml) => {
    visitIdeaXml(xml, (path, a) => {
      if (path === 'project/component' && a.name === 'ProjectRootManager') project = a['project-jdk-name'];
    });
  });
  await files.xml('.idea/modules.xml', (xml) => {
    visitIdeaXml(xml, (path, a) => {
      if (path !== 'project/component/modules/module') return;
      const iml = projectPath(a.filepath ?? a.fileurl?.replace(/^file:\/\//, '') ?? '');
      if (iml?.endsWith('.iml') && paths.size < MAX_FILES) paths.add(iml);
    });
  });
  for (const iml of paths) {
    await files.xml(iml, (xml) => {
      visitIdeaXml(xml, (path, a) => {
        if (path === 'module/component/orderEntry' && a.type === 'jdk' && a.jdkName)
          modules.set(basename(iml, '.iml'), a.jdkName);
      });
    });
  }
  return { project, modules };
}

/** Private workspace configurations stay in the registered checkout. Only launch hints cross into the task. */
export async function readIdeaConfigurations(worktreeRoot: string, projectRoot: string) {
  const warnings = new Set<string>();
  const configurations: IdeConfiguration[] = [];
  const seen = new Set<string>();
  const local = await realpath(projectRoot);
  const tree = await realpath(worktreeRoot);
  const project = reader(local, 'project', warnings);
  const worktree = reader(tree, 'worktree', warnings);
  const localSdk = await sdkSettings(project);
  const treeSdk = tree === local ? localSdk : await sdkSettings(worktree);
  for (const files of tree === local ? [worktree] : [worktree, project]) {
    const sdk = files === project ? localSdk : treeSdk;
    const modules = new Map([...localSdk.modules, ...sdk.modules]);
    const sources = [
      ...(await files.configs('.run', '.run.xml')),
      ...(await files.configs('.idea/runConfigurations', '.xml')),
      '.idea/workspace.xml',
    ];
    for (const source of sources) {
      await files.xml(source, (xml) => {
        for (const config of parseIdeaConfigurations(
          xml,
          source,
          files.location,
          sdk.project ?? localSdk.project,
          modules,
        )) {
          const { source: _source, location: _location, ...settings } = config;
          const key = JSON.stringify(settings, Object.keys(settings).sort());
          if (seen.has(key)) continue;
          if (configurations.length >= MAX_CONFIGS) {
            warnings.add('Configuration limit reached');
            break;
          }
          seen.add(key);
          configurations.push(config);
        }
      });
    }
  }
  return { configurations, warnings: [...warnings] };
}
