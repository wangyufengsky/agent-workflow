import type { Prompts } from '@aw/builtin';
import type { Acceptance, PlanGraph } from '@aw/shared';
import type { Clock } from '../../core/clock.ts';
import type { Db } from '../../core/db/database.ts';
import type { UnitOfWork } from '../../core/db/unit-of-work.ts';
import type { Logger } from '../../core/logger.ts';
import type { AcceptanceService } from '../acceptance/index.ts';
import type { AttemptsService } from '../attempts/index.ts';
import type { RepoLocks } from '../git/index.ts';
import type { InboxService } from '../inbox/index.ts';
import type { RolesService } from '../roles/index.ts';
import type { SettingsService } from '../settings/index.ts';

export type NodesServiceDeps = {
  db: Db;
  unit: UnitOfWork;
  clock: Clock;
  log: Logger;
  attempts: AttemptsService;
  acceptance: AcceptanceService;
  inbox: InboxService;
  roles: RolesService;
  settings: SettingsService;
  prompts: Prompts;
  locks: RepoLocks;
};

/** What running a node needs to know about its task; the tasks module provides it. */
export type NodeRunContext = {
  taskId: string;
  projectId: string;
  taskKey: string;
  taskTitle: string;
  requirement: string;
  /** The task worktree. */
  directory: string;
  /** The project repository, whose lock guards ref changes (D37). */
  repoPath: string;
  /** The project check command, which a reviewer may run without asking (12 §2). */
  checkCommand: string | null;
  askOnUncertainty: boolean;
};

export type MaterializeInput = {
  taskId: string;
  planId: string;
  graph: PlanGraph;
  checkCommand: string | null;
  defaultAcceptance: Acceptance;
  acceptEachNode: boolean;
};
