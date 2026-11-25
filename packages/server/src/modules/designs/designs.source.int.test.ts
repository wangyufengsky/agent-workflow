import { rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDesignOp, deleteProjectOp, getDesignSourceOp } from '@aw/shared';
import { expect, it } from 'vitest';
import { createTestApp } from '../../../test/helpers/app.ts';
import { addProject } from '../../../test/helpers/tasks.ts';

it('文件页只读本设计扫描版本；文件修改、移走、链接到排除文件及删除项目时不返回源码', async () => {
  const app = await createTestApp();
  try {
    const content = 'export const name = "订单";\r\n';
    const { project, repo } = await addProject(app, { files: { 'src/order.ts': content, '.env': content } });
    const { body: design } = await app.call(createDesignOp, { projectId: project.id });
    const file = design.files.find(({ relPath }) => relPath === 'src/order.ts');
    if (!file) throw new Error('Expected the scanned source');
    const read = async () => (await app.call(getDesignSourceOp, { id: design.id, fileId: file.id })).body;
    expect(await read()).toEqual({ status: 'available', content });
    const path = join(repo.path, file.relPath);
    await writeFile(path, 'updated');
    expect(await read()).toEqual({ status: 'changed' });
    await rename(path, `${path}.moved`);
    expect(await read()).toEqual({ status: 'unavailable' });
    await symlink(join(repo.path, '.env'), path);
    expect(await read()).toEqual({ status: 'unavailable' });
    const { body: other } = await app.call(createDesignOp, { projectId: project.id });
    expect((await app.call(getDesignSourceOp, { id: other.id, fileId: file.id })).body).toEqual({
      status: 'unavailable',
    });
    await app.call(deleteProjectOp, { id: project.id });
    expect(await read()).toEqual({ status: 'unavailable' });
  } finally {
    await app.close();
  }
});
