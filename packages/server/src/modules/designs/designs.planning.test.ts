import { expect, it } from 'vitest';
import { planningInventory } from './designs.planning.ts';

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
