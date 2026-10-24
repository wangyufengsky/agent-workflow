/**
 * Every item of a paginated list (11 §1): pages are read one after another until `nextCursor` is null. For lists a
 * page shows whole and filters itself, such as the initiatives (34 §5.1), so nothing past the first page goes missing.
 */
export async function allPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}
