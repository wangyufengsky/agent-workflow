// Adapts node:sqlite's DatabaseSync to the subset of the better-sqlite3 API that drizzle's better-sqlite3 session
// uses, so drizzle runs synchronously: real transactions with no await interleaving between requests (D30).
import type { DatabaseSync, SQLInputValue, StatementResultingChanges, StatementSync } from 'node:sqlite';

type Params = SQLInputValue[];

/** better-sqlite3's `statement.raw()`: rows as arrays. node:sqlite toggles this per statement, so scope it per call. */
class RawStatement {
  readonly #stmt: StatementSync;
  constructor(stmt: StatementSync) {
    this.#stmt = stmt;
  }
  #asArrays<T>(read: () => T): T {
    this.#stmt.setReturnArrays(true);
    try {
      return read();
    } finally {
      this.#stmt.setReturnArrays(false);
    }
  }
  all(...params: Params): unknown[] {
    return this.#asArrays(() => this.#stmt.all(...params));
  }
  get(...params: Params): unknown {
    return this.#asArrays(() => this.#stmt.get(...params));
  }
}

class Statement {
  readonly #stmt: StatementSync;
  constructor(stmt: StatementSync) {
    this.#stmt = stmt;
  }
  raw(): RawStatement {
    return new RawStatement(this.#stmt);
  }
  run(...params: Params): StatementResultingChanges {
    return this.#stmt.run(...params);
  }
  all(...params: Params): unknown[] {
    return this.#stmt.all(...params);
  }
  get(...params: Params): unknown {
    return this.#stmt.get(...params);
  }
}

export class NodeSqliteClient {
  readonly #db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.#db = db;
  }
  prepare(sql: string): Statement {
    return new Statement(this.#db.prepare(sql));
  }
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const run =
      (mode: 'DEFERRED' | 'IMMEDIATE' | 'EXCLUSIVE') =>
      (...args: A): R => {
        this.#db.exec(`BEGIN ${mode}`);
        try {
          const result = fn(...args);
          this.#db.exec('COMMIT');
          return result;
        } catch (err) {
          this.#db.exec('ROLLBACK');
          throw err;
        }
      };
    return { deferred: run('DEFERRED'), immediate: run('IMMEDIATE'), exclusive: run('EXCLUSIVE') };
  }
}
