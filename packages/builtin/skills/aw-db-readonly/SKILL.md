---
name: aw-db-readonly
description: Use when a question, step or review involves data in a project database: db_list_connections, db_describe, db_query, or the assistant's databases_list, databases_schema, databases_query. How to investigate read-only step by step, write SQL in the connection's dialect, read the returned values, keep results small and handle the query errors.
---

# Investigating data read-only

Every query is checked to be one read-only statement (`SELECT`, and `SHOW` / `DESCRIBE` / `EXPLAIN` where the database has them) and runs in a read-only transaction. A query returns at most 200 rows and is stopped after 15 seconds.

| | Task sessions and the knowledge researcher | The assistant (pro mode only) |
| --- | --- | --- |
| Connections | `agent-workflow_db_list_connections` (the project's linked ones) | `agent-workflow-app_databases_list` |
| Tables and columns | `agent-workflow_db_describe` `{ connection, table? }` | `agent-workflow-app_databases_schema` `{ id }` |
| Query | `agent-workflow_db_query` `{ connection, sql, limit? }` | `agent-workflow-app_databases_query` `{ id, sql, limit? }` |

## Steps

1. List the connections and note each one's `type`: it decides the SQL dialect.
2. Find the tables: describe without a table (names, comments, estimated rows), then the tables you need (columns, types, indexes). Do not guess column names.
3. Count before you read: `SELECT COUNT(*) FROM … WHERE …` for the rows that matter.
4. Look at a few rows with a limit, selecting only the columns you need. On large tables, filter on indexed columns.
5. Answer with aggregates (`COUNT`, `SUM`, `MIN` / `MAX`, `GROUP BY`) instead of reading many rows.

## Dialects

| | MySQL / GoldenDB | PostgreSQL / openGauss | SQL Server |
| --- | --- | --- | --- |
| Quoting names | `` `name` `` | `"name"` (unquoted names fold to lower case) | `[name]` or `"name"` |
| Limiting rows | `LIMIT n` | `LIMIT n` | `TOP n` / `OFFSET … FETCH` |
| Table structure | `SHOW`, `DESCRIBE` | describe tool (no `DESCRIBE`) | describe tool |

## Reading the values

- `BIGINT` and `DECIMAL` come back as strings; compare them as numbers. SQL Server returns `DECIMAL` as a number, which loses precision beyond 2^53: cast to a string type in SQL when the exact value matters.
- Dates are the server's text. In openGauss's default A compatibility mode a `DATE` carries a time (`2026-01-02 00:00:00`).
- Binary values are `0x…` hex, at most 64 bytes.
- `truncated: true` means more rows exist: what you got is not the whole set. Count or aggregate instead of drawing conclusions from it.

## Errors

- `DB_QUERY_REJECTED`: not a single read-only statement (a write, a lock such as `FOR UPDATE`, `INTO`, several statements). Rewrite it as one `SELECT`.
- `DB_QUERY_TIMEOUT`: narrow it: filter on an indexed column, avoid functions on indexed columns in `WHERE`, select fewer columns, aggregate.
- `DB_QUERY_FAILED`: read `details.driverMessage` and fix the SQL for the dialect.
- `DB_CONNECTION_FAILED`: the database is out of reach. Say so; trying the same query again will not help.
- `CREDENTIAL_LOCKED`: the database password is protected by the master password, not unlocked yet. If you can ask the user, ask them to unlock it at the top of the app; otherwise continue without the database and say so.

## Personal data

Do not copy personal data (names, phone numbers, ID numbers, email or postal addresses) from the database into answers, results, code or tests; give counts, or mask the values. Never hard-code rows you read into code or test fixtures.

## Citing a query (knowledge researcher)

Cite a database result as `{ "type": "database", "connection": "<name>", "sql": "<the exact query>" }`, the query whose result supports the statement.
