/**
 * Lower-case ASCII slug keeping only `[a-z0-9-]` (08 §4.1 branch / directory names).
 * Returns '' when nothing ASCII remains (e.g. a purely Chinese title); callers decide what that means.
 */
export function toSlug(text: string, maxLength: number): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}
