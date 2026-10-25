export const PLAN_MAX_NODES = 20;
export const NODE_INSTRUCTIONS_MAX_CHARS = 8000;
export const REQUIREMENT_MAX_CHARS = 20000;
export const ATTEMPT_MAX_NUDGES = 1;
export const ACCEPTANCE_COMMAND_TIMEOUT_MS = 600_000;
export const DB_QUERY_MAX_ROWS = 200;
export const DB_QUERY_TIMEOUT_MS = 15_000;
/** Opening a connection to a project database (test, schema, the AI's database tools). */
export const DB_CONNECT_TIMEOUT_MS = 10_000;
export const TRANSCRIPT_PAGE_SIZE = 200;
/** A streaming text or reasoning part writes the characters it grew by once there are this many (10 §3, D104). */
export const TRANSCRIPT_TEXT_FLUSH_CHARS = 32;
/** SSE events kept in memory for `Last-Event-ID` replay. */
export const SSE_REPLAY_BUFFER = 1000;
export const DIFF_FILE_MAX_BYTES = 1_048_576;
/** `report_progress` message (12 §6.8). */
export const REPORT_PROGRESS_MAX_CHARS = 200;
/** `submit_result` summary (12 §6.5). */
export const RESULT_SUMMARY_MAX_CHARS = 4000;
/** A task title taken from the requirement's first line is cut to this length. */
export const TASK_TITLE_MAX_CHARS = 80;
/** Output of an acceptance command kept on the node (its end, where failures are reported). */
export const ACCEPTANCE_OUTPUT_MAX_CHARS = 20_000;
/** `GET /system/runtime/logs`: lines returned by default and at most. */
export const RUNTIME_LOG_TAIL_DEFAULT = 500;
export const RUNTIME_LOG_TAIL_MAX = 5000;
/** Storage cleanup keeps logs and the session records of tasks that ended within this many days (37 §3). */
export const STORAGE_KEEP_DAYS = 7;
/** Page size of the task and inbox lists (11 §1 pagination): the default and the largest `limit`. */
export const LIST_PAGE_DEFAULT = 50;
export const LIST_PAGE_MAX = 100;
/**
 * Putting a directory under Git (D153): a file or a first commit this large is worth an ignore rule first; the
 * confirmation names at most `GIT_INIT_LARGE_FILES_SHOWN` of the large files.
 */
export const GIT_INIT_LARGE_FILE_BYTES = 50 * 1024 * 1024;
export const GIT_INIT_LARGE_TOTAL_BYTES = 500 * 1024 * 1024;
export const GIT_INIT_LARGE_FILES_SHOWN = 5;
/** One initiative (34 §11): work packages, phases, source attachments (one input slot is left for the background). */
export const INITIATIVE_ITEMS_MAX = 30;
export const INITIATIVE_PHASES_MAX = 6;
export const INITIATIVE_SOURCES_MAX = 9;
export const INITIATIVE_TITLE_MAX_CHARS = 60;
/** A work package's requirement is its task's requirement. */
export const INITIATIVE_ITEM_REQUIREMENT_MAX_CHARS = REQUIREMENT_MAX_CHARS;
/** A phase's title and goal, and the reason for dropping a work package. */
export const INITIATIVE_PHASE_TITLE_MAX_CHARS = 40;
export const INITIATIVE_PHASE_GOAL_MAX_CHARS = 500;
export const INITIATIVE_REASON_MAX_CHARS = 2000;
/** The user's feedback for a new breakdown or a refinement (34 §5.2, §5.5). */
export const INITIATIVE_INSTRUCTION_MAX_CHARS = 2000;
/** The AI's breakdown summary and its understanding's scope (34 §8.2). */
export const INITIATIVE_SUMMARY_MAX_CHARS = 2000;
/** Targets of one batch (20 §2, D85). */
export const BATCH_TARGETS_MAX = 20;
export const BATCH_TARGET_MAX_CHARS = 500;
/** Scheduled tasks (22): due schedules are looked for at least this often, so a computer waking up finds them soon. */
export const SCHEDULE_CHECK_INTERVAL_MS = 60_000;
/** A run handled this long after its time is a catch-up (22 §4). */
export const SCHEDULE_CATCH_UP_AFTER_MS = 300_000;
/** Runs listed on a schedule's page, newest first. */
export const SCHEDULE_RUNS_SHOWN = 20;
/** `hourly` frequencies: divisors of 24, so a day's run times are the same every day (22 §2, D90). */
export const SCHEDULE_EVERY_HOURS = [1, 2, 3, 4, 6, 8, 12] as const;
/** A conversation's title taken from its first message is cut to this length. */
export const ASSISTANT_TITLE_MAX_CHARS = 40;
/** One message to the assistant. */
export const ASSISTANT_MESSAGE_MAX_CHARS = 20_000;
/** Charts the assistant draws in a conversation (35 §3, D140). */
export const CHART_TITLE_MAX_CHARS = 60;
/** A category, series or flowchart node label. */
export const CHART_LABEL_MAX_CHARS = 40;
export const CHART_CAPTION_MAX_CHARS = 200;
export const CHART_UNIT_MAX_CHARS = 8;
export const CHART_SERIES_MAX = 6;
/** Categories per chart type: a month by day of bars, a quarter by day of lines, slices still told apart by colour. */
export const CHART_CATEGORIES = {
  bar: { min: 1, max: 31 },
  line: { min: 2, max: 90 },
  pie: { min: 1, max: 8 },
} as const;
export const FLOWCHART_NODES_MAX = 24;
export const FLOWCHART_EDGES_MAX = 48;
export const FLOWCHART_NODE_ID_MAX_CHARS = 32;
export const FLOWCHART_EDGE_LABEL_MAX_CHARS = 16;
/** 一次显式附加的文字或任务上下文；超过时由用户缩短，任务快照注明截断。 */
export const ASSISTANT_CONTEXT_MAX_CHARS = 12_000;
/** 旧会话隔离升级时回放的最近记录和文字上限。 */
export const ASSISTANT_RECOVERY_ENTRIES = 200;
export const ASSISTANT_RECOVERY_MAX_CHARS = 12_000;
/** Knowledge Q&A (18 §7). */
export const KNOWLEDGE_QUESTION_MAX_CHARS = 4000;
/** A conversation's title taken from its first question is cut to this length. */
export const KNOWLEDGE_TITLE_MAX_CHARS = 80;
export const KNOWLEDGE_ANSWER_MAX_CHARS = 20_000;
export const KNOWLEDGE_MAX_CITATIONS = 20;
/** Lines one file citation may span. */
export const KNOWLEDGE_CITATION_MAX_LINES = 200;
/** The cited lines kept with a file citation, to show without reading the file and to tell whether it changed. */
export const KNOWLEDGE_EXCERPT_MAX_CHARS = 4000;
/** Lines shown before and after a cited range in the source panel. */
export const KNOWLEDGE_SOURCE_CONTEXT_LINES = 40;
/** Rows of a cited query shown when its source is opened. */
export const KNOWLEDGE_QUERY_ROWS = 50;
/** The latest answer's excerpt in the conversation list. */
export const KNOWLEDGE_ANSWER_EXCERPT_CHARS = 160;
/** Days a custom quality and usage period may span (19 §2.2). */
export const INSIGHTS_MAX_DAYS = 366;
/** PPT (23 §10). */
export const DECK_BRIEF_MAX_CHARS = 4000;
/** A PPT's title, taken from the brief's first line until the outline gives one. */
export const DECK_TITLE_MAX_CHARS = 60;
export const DECK_MATERIALS_MAX = 10;
/** All material of one PPT together: it goes into the first message (23 §7.2). */
export const DECK_MATERIALS_MAX_CHARS = 60_000;
export const DECK_INSTRUCTION_MAX_CHARS = 2000;
export const DECK_MAX_SLIDES = 30;
/** Pages the AI picks from when the user lets it decide. */
export const DECK_AUTO_SLIDES_MIN = 5;
export const DECK_AUTO_SLIDES_MAX = 12;
/** An outline page's points: what the page is to say. */
export const SLIDE_POINTS_MAX = 6;
export const SLIDE_POINT_MAX_CHARS = 120;
export const SLIDE_NOTES_MAX_CHARS = 1000;
/**
 * Characters per text field of a page, sized so the text fits the 1280×720 canvas at the theme's smallest font size
 * (23 §5.1). Counted in UTF-16 units: one per Chinese character.
 */
export const SLIDE_TEXT_LIMITS = {
  title: 40,
  subtitle: 80,
  bullet: 60,
  bullets: 6,
  columnHeading: 20,
  columnBullet: 40,
  columnBullets: 5,
  cardHeading: 16,
  cardBody: 80,
  cardsMin: 2,
  cardsMax: 4,
  stepLabel: 12,
  stepDetail: 40,
  stepsMin: 2,
  stepsMax: 6,
  statValue: 12,
  statLabel: 24,
  statsMax: 4,
  tableColumnsMin: 2,
  tableColumnsMax: 5,
  tableHeader: 16,
  tableCell: 30,
  tableRows: 8,
  codeLines: 16,
  codeLineChars: 80,
  codeLanguage: 20,
  caption: 60,
  quote: 120,
  attribution: 40,
} as const;
/** Text that does not fit is shrunk down to this scale before the page is flagged (23 §5.4). */
export const SLIDE_FIT_MIN_SCALE = 0.8;
/** Git workbench (27): a commit message, the commits a push confirmation lists, a review's focus. */
export const COMMIT_MESSAGE_MAX_CHARS = 10_000;
export const GIT_PUSH_COMMITS_SHOWN = 20;
export const GIT_REVIEW_FOCUS_MAX_CHARS = 200;
/** `submit_findings` (27 §4.4). */
export const GIT_REVIEW_FINDINGS_MAX = 50;
export const GIT_REVIEW_SUMMARY_MAX_CHARS = 2000;
export const GIT_REVIEW_FINDING_TITLE_MAX_CHARS = 120;
export const GIT_REVIEW_FINDING_TEXT_MAX_CHARS = 2000;
/** The diff a commit message draft is written from is cut to this size (27 §7.3). */
export const COMMIT_DRAFT_DIFF_MAX_BYTES = 60_000;
/** Page previews (29 §4): starting one, probing its ready path, the log tail kept when it fails, its key pages. */
export const PREVIEW_START_TIMEOUT_MS = 120_000;
/** The setup command (dependency install) of a worktree's first start; a cold install takes minutes. */
export const PREVIEW_SETUP_TIMEOUT_MS = 600_000;
export const PREVIEW_PROBE_INTERVAL_MS = 1000;
export const PREVIEW_LOG_TAIL_CHARS = 4000;
export const PREVIEW_PAGES_MAX = 10;
/** Browser actions (29 §5.5): waiting for a target to be hittable, and for the page to settle afterwards. */
export const BROWSER_ACTION_TIMEOUT_MS = 5000;
export const BROWSER_SETTLE_QUIET_MS = 500;
export const BROWSER_SETTLE_TIMEOUT_MS = 10_000;
/** 助手一次网页文字读取的总时限，包含打开、导航与提取。 */
export const BROWSER_READ_TIMEOUT_MS = 30_000;
/** The longest `browser_wait_for` (29 §6). */
export const BROWSER_WAIT_FOR_MAX_MS = 10_000;
/** A page snapshot is cut to this many characters (29 §5.6). */
export const BROWSER_SNAPSHOT_MAX_CHARS = 12_000;
/** The thumbnail kept after each AI browser action for the user to watch (29 §5.7): its width and JPEG quality. */
export const BROWSER_FRAME_WIDTH = 960;
export const BROWSER_FRAME_QUALITY = 60;
/** A page check's full-page screenshot stops at this height in CSS pixels (29 §7.2). */
export const PAGE_CHECK_SHOT_MAX_HEIGHT = 8000;
/** Attachments (30): one input's count, one file's size, a display name, and how long an unsent one is kept. */
export const ATTACHMENTS_PER_INPUT_MAX = 10;
export const ATTACHMENT_BYTES_MAX = 5 * 1024 * 1024;
export const ATTACHMENT_NAME_MAX_CHARS = 255;
export const ATTACHMENT_ORPHAN_TTL_MS = 24 * 60 * 60 * 1000;
export const ATTACHMENT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
/** What the model gets of attachments (30 §3.2): all of one input's text in the prompt, and one `read_attachment` page. */
export const ATTACHMENT_PROMPT_MAX_CHARS = 20_000;
export const ATTACHMENT_READ_MAX_CHARS = 12_000;
/** A task's acceptance checklist (31): items per version, and the lengths of an item's texts and of a note. */
export const REQUIREMENTS_MAX = 30;
export const REQUIREMENT_TITLE_MAX_CHARS = 120;
export const REQUIREMENT_EXPECTED_MAX_CHARS = 2000;
export const REQUIREMENT_NOTE_MAX_CHARS = 4000;

/** Master password (D167): a short one is cheap to guess offline from a copied app.db, scrypt or not. */
export const MASTER_PASSWORD_MIN_LENGTH = 8;
export const MASTER_PASSWORD_MAX_LENGTH = 1024;
