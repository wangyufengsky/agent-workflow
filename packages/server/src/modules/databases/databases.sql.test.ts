import { ErrorCode } from '@aw/shared';
import { describe, expect, it } from 'vitest';
import { assertReadOnlySql } from './databases.sql.ts';

const rejected = { code: ErrorCode.DbQueryRejected };

describe('assertReadOnlySql', () => {
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
    expect(() => assertReadOnlySql(sql)).not.toThrow();
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
    expect(() => assertReadOnlySql(sql)).toThrow(expect.objectContaining(rejected));
  });
});
