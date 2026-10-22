/** One row of the commit graph (27 §6.2): where the commit's dot sits and which lines cross its row. */
export type GraphRow = {
  lane: number;
  /** A child above continues into the dot. */
  up: boolean;
  /** The first parent continues below the dot in the same lane. */
  down: boolean;
  /** Lanes passing straight through the row. */
  pass: number[];
  /** Lanes of other children that end in this commit (branches forked here), curving into the dot from above. */
  inFrom: number[];
  /** Lanes the commit's other parents continue in (a merge), curving out of the dot below. */
  out: number[];
  /** Lanes still open below the row, for rows drawn between commits (day headings). */
  after: number[];
};

/**
 * Lanes for commits listed newest first (`git log` order): each lane waits for the next commit it leads to. A commit
 * takes the lane waiting for it (or a free one), its first parent stays in that lane and further parents get lanes of
 * their own. Commits whose parents are not listed simply end their lane at the bottom of the list.
 */
export function layoutGraph(commits: ReadonlyArray<{ sha: string; parents: readonly string[] }>): GraphRow[] {
  const lanes: Array<string | null> = [];
  const free = () => {
    const index = lanes.indexOf(null);
    return index < 0 ? lanes.length : index;
  };
  return commits.map(({ sha, parents }) => {
    const waiting = lanes.flatMap((expected, i) => (expected === sha ? [i] : []));
    const lane = waiting[0] ?? free();
    const inFrom = waiting.slice(1);
    for (const i of inFrom) lanes[i] = null;
    const pass = lanes.flatMap((expected, i) => (expected !== null && i !== lane ? [i] : []));
    const [first, ...others] = parents;
    lanes[lane] = first ?? null;
    const out = others.map((parent) => {
      const existing = lanes.indexOf(parent);
      if (existing >= 0) return existing;
      const index = free();
      lanes[index] = parent;
      return index;
    });
    while (lanes.length > 0 && lanes.at(-1) === null) lanes.pop();
    return {
      lane,
      up: waiting.length > 0,
      down: first !== undefined,
      pass,
      inFrom,
      out,
      after: lanes.flatMap((expected, i) => (expected === null ? [] : [i])),
    };
  });
}
