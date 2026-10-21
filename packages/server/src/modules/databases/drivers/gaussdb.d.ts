// gaussdb-node and gaussdb-cursor are Huawei's forks of pg and pg-cursor (adding openGauss's sha256 login, D97) with
// the same API and no type declarations of their own.
declare module 'gaussdb-node' {
  import * as pg from 'pg';
  export = pg;
}

declare module 'gaussdb-cursor' {
  import Cursor = require('pg-cursor');
  export = Cursor;
}
