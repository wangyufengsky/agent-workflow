import { z } from 'zod';

const targetParts = z.tuple([z.string().min(1), z.string().min(1)]);

export function encodeGitImpactTargetId(parentId: string, childId: string): string {
  return JSON.stringify([parentId, childId]);
}

export function decodeGitImpactTargetId(targetId: string): readonly [parentId: string, childId: string] | undefined {
  try {
    const parsed = targetParts.safeParse(JSON.parse(targetId));
    return parsed.success ? parsed.data : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}
