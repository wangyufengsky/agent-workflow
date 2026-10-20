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
/** A streaming text part is written to the transcript again once it grew by this many characters (10 §3). */
export const TRANSCRIPT_TEXT_FLUSH_CHARS = 200;
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
/** Page size of the task and inbox lists (11 §1 pagination): the default and the largest `limit`. */
export const LIST_PAGE_DEFAULT = 50;
export const LIST_PAGE_MAX = 100;
