import { HostingSource, type ProjectDetailDTO } from '@aw/shared';
import { GIT_COPY as C } from '../../copy/git.ts';
import { PROJECTS_COPY } from '../../copy/projects.ts';

/**
 * What the Git pages say about the project's platform (D155): whose token signs in, or why none does: origin is a
 * platform without a token, or there is no recognisable platform at all.
 */
export function hostingState(project: ProjectDetailDTO): {
  signedIn: boolean;
  chip: string;
  title: string;
  detail: string;
} {
  const effective = project.effectiveHosting;
  if (effective?.source === HostingSource.Project) {
    const chip = PROJECTS_COPY.providers[effective.provider];
    return { signedIn: true, chip, title: C.hostingBound, detail: C.hostingCard(effective.repo) };
  }
  if (effective?.source === HostingSource.Global) {
    const chip = C.hostingGlobal(effective.provider);
    return { signedIn: true, chip, title: chip, detail: C.hostingCardGlobal(effective.repo) };
  }
  const known = project.hosting ?? project.inferredHosting;
  if (known !== null) {
    const chip = C.hostingNoToken(known.provider);
    return { signedIn: false, chip, title: chip, detail: C.hostingCardNoToken(known.repo) };
  }
  return { signedIn: false, chip: C.hostingNoRemote, title: C.hostingNoRemote, detail: C.hostingCardNoRemote };
}
