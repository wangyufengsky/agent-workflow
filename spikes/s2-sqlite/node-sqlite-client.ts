// Adapts node:sqlite's DatabaseSync to the subset of the better-sqlite3 API that drizzle's
// better-sqlite3 session uses, so drizzle runs synchronously (real transactions, no await interleaving).
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';

type Params = SQLInputValue[];

class Statement {
  #stmt: StatementSync;
  #raw = false;
  constructor(stmt: StatementSync) {
    this.#stmt = stmt;
  }
  raw(): this {
    this.#raw = true;
    this.#stmt.setReturnArrays(true);
    return this;
  }
  run(...params: Params) {
    return this.#stmt.run(...params);
  }
  all(...params: Params) {
    return this.#stmt.all(...params);
  }
  get(...params: Params) {
    return this.#stmt.get(...params);
  }
}

export class NodeSqliteClient {
  readonly db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }
  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }
  transaction<A extends unknown[], R>(fn: (...args: A) => R) {
    const run =
      (mode: string) =>
      (...args: A): R => {
        this.db.exec(`BEGIN ${mode}`);
        try {
          const result = fn(...args);
          this.db.exec('COMMIT');
          return result;
        } catch (err) {
          this.db.exec('ROLLBACK');
          throw err;
        }
      };
    return { deferred: run('DEFERRED'), immediate: run('IMMEDIATE'), exclusive: run('EXCLUSIVE') };
  }
}
