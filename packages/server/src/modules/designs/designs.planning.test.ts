import { expect, it } from 'vitest';
import { designFilePage, planningInventory } from './designs.planning.ts';

it('大目录与小目录都有可读样本，统计包含未发送的文件', () => {
  const inventory = [
    ...Array.from({ length: 1000 }, (_, i) => ({ relPath: `src/payments/${i}.ts` })),
    { relPath: 'src/refunds/entry.ts' },
    { relPath: 'README.md' },
  ];
  const result = planningInventory(inventory);
  expect(result.inventorySampled).toBe(true);
  expect(result.authorizedFiles.length).toBeLessThan(inventory.length);
  expect(result.authorizedFiles).toEqual(expect.arrayContaining(inventory.slice(-2)));
  expect(result.directories).toContainEqual({ scope: 'src/payments', fileCount: 1000 });
});

it('一万条长路径的授权清单小于 16 KiB，保留归属，并能按关键词定位样本外的文件', () => {
  const files = Array.from({ length: 10_000 }, (_, i) => ({
    relPath: `模块${i % 520}/src/main/java/example/payments/TransactionHandler${i}.java`,
    sectionId: 'payments',
  }));
  const inventory = planningInventory(files);
  expect(Buffer.byteLength(JSON.stringify(inventory))).toBeLessThanOrEqual(16 * 1024);
  expect(inventory.fileCount).toBe(10_000);
  expect(inventory.authorizedFiles[0]?.sectionId).toBe('payments');
  const outside = files.find((file) => !inventory.authorizedFiles.some((sample) => sample.relPath === file.relPath));
  if (!outside) throw new Error('Expected an unsampled path');
  expect(designFilePage(files, outside.relPath, 0)).toEqual({ files: [outside], total: 1, nextOffset: null });
  const first = designFilePage(files, 'TransactionHandler', 0);
  const second = designFilePage(files, 'TransactionHandler', first.files.length);
  expect(first.nextOffset).toBe(first.files.length);
  expect([...first.files, ...second.files]).toEqual(files.slice(0, first.files.length + second.files.length));
});
