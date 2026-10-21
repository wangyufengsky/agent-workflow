import { DbType, ErrorCode } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { assertReadOnlySql } from './databases.sql.ts';

const rejected = { code: ErrorCode.DbQueryRejected };

describe('assertReadOnlySql：MySQL / GoldenDB', () => {
  it.each([
    'SELECT * FROM orders WHERE id = 1',
    '  select 1;  ',
    '(SELECT 1) UNION (SELECT 2)',
    'SHOW TABLES',
    'DESCRIBE orders',
    'desc orders',
    'EXPLAIN SELECT * FROM orders',
    "SELECT ';DELETE FROM t' AS s",
    'SELECT `into` FROM t -- ; DROP TABLE t',
    'SELECT 1 /* ; UPDATE t SET a = 1 */',
    "SELECT 'it''s', \"a\\\"b\" FROM t # INTO OUTFILE",
  ])('放行只读语句：%s', (sql) => {
    expect(() => assertReadOnlySql(sql, DbType.Mysql)).not.toThrow();
  });

  it.each([
    ['写语句', 'DELETE FROM orders'],
    ['WITH 开头（MySQL 允许 WITH … UPDATE）', 'WITH x AS (SELECT 1) UPDATE t SET a = 1'],
    ['多条语句', 'SELECT 1; DROP TABLE orders'],
    ['分号后跟注释外的内容', 'SELECT 1;;'],
    ['可执行注释', 'SELECT 1 /*!50000 ; DELETE FROM t */'],
    ['写服务器文件', "SELECT * FROM t INTO OUTFILE '/tmp/x'"],
    ['写变量', 'SELECT id INTO @x FROM t'],
    ['加锁读', 'SELECT * FROM t FOR UPDATE'],
    ['共享锁读', 'SELECT * FROM t LOCK IN SHARE MODE'],
    ['空语句', '  -- nothing'],
    ['未闭合的字符串', "SELECT 'oops"],
  ])('拒绝%s', (_name, sql) => {
    expect(() => assertReadOnlySql(sql, DbType.Goldendb)).toThrow(expect.objectContaining(rejected));
  });
});

describe('assertReadOnlySql：PostgreSQL / openGauss', () => {
  it.each([
    'SELECT * FROM orders',
    'SHOW server_version',
    'EXPLAIN ANALYZE SELECT 1',
    // A backslash is an ordinary character in standard strings; `#` is an operator, not a comment.
    "SELECT '\\' AS backslash, 5 # 3 AS xor",
    "SELECT E'it\\'s;' AS s",
    "SELECT $$a; DELETE FROM t$$, $tag$it's$tag$",
    'SELECT 1 /* outer /* nested ; */ still comment */',
    'SELECT "into" FROM t --; DELETE',
  ])('放行只读语句：%s', (sql) => {
    expect(() => assertReadOnlySql(sql, DbType.Postgresql)).not.toThrow();
  });

  it.each([
    ['DESCRIBE（PostgreSQL 没有）', 'DESCRIBE orders'],
    ['SELECT INTO 建表', 'SELECT * INTO copy FROM orders'],
    ['加锁读', 'SELECT * FROM orders FOR NO KEY UPDATE'],
    ['共享锁读', 'SELECT * FROM orders FOR KEY SHARE'],
    ['美元引号外的第二条语句', 'SELECT $$x$$; DELETE FROM t'],
    ['未闭合的嵌套注释', 'SELECT 1 /* /* */'],
  ])('拒绝%s', (_name, sql) => {
    expect(() => assertReadOnlySql(sql, DbType.Opengauss)).toThrow(expect.objectContaining(rejected));
  });
});

describe('assertReadOnlySql：SQL Server', () => {
  it.each([
    'SELECT TOP 10 * FROM dbo.orders WITH (NOLOCK) ORDER BY id',
    "SELECT [update], [delete] FROM t WHERE note = N'INSERT; DROP'",
    "SELECT 'a\\' AS s, updated_at, last_update FROM t -- EXEC xp_cmdshell",
    'SELECT @@VERSION, @@TRANCOUNT',
  ])('放行只读语句：%s', (sql) => {
    expect(() => assertReadOnlySql(sql, DbType.Sqlserver)).not.toThrow();
  });

  it.each([
    ['SHOW（T-SQL 没有）', 'SHOW TABLES'],
    // T-SQL needs no semicolon between statements: the second one is found by its keyword.
    ['不带分号的第二条语句', 'SELECT 1 DELETE FROM orders'],
    ['提交后写入', 'SELECT 1 COMMIT UPDATE t SET a = 1'],
    ['执行存储过程', "SELECT 1 EXEC xp_cmdshell 'dir'"],
    ['SELECT INTO 建表', 'SELECT * INTO #copy FROM orders'],
    ['加锁读', 'SELECT * FROM orders WITH (UPDLOCK)'],
    ['跨服务器查询', "SELECT * FROM OPENQUERY(remote, 'DELETE FROM t')"],
    ['注释之后换行的写语句', 'SELECT 1 -- x\rDELETE FROM t'],
    ['方括号里的分号之后', 'SELECT [a;b]; DROP TABLE t'],
  ])('拒绝%s', (_name, sql) => {
    expect(() => assertReadOnlySql(sql, DbType.Sqlserver)).toThrow(expect.objectContaining(rejected));
  });
});
