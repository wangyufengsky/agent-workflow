/**
 * The workflow mark: three nodes joined by two lines, on a 124×24 grid. The home hero and the opening animation
 * (28 §2.1, §5.1) draw it from these numbers so they stay the same picture.
 */
export const MARK = {
  width: 124,
  height: 24,
  radius: 6,
  /** Centres on y = 12; the middle node is filled. */
  nodes: [8, 62, 116],
  lines: ['M14 12H56', 'M68 12H110'],
} as const;
