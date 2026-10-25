# 24 · 更多数据库（v1.2）

项目数据库在 MySQL 之外支持 PostgreSQL、openGauss / GaussDB、SQL Server 与 GoldenDB（[04 §5.2](04-project-plan.md#52-v12原-v12-与-v13-合并) 第 4 项）。连接管理、表结构浏览、AI 的只读查询工具（12 §6.9–6.11）与应用助手的 `databases.query` 对五种类型行为一致，全部只读（D07）。

决策：D97（驱动选择）、D98（SQL Server 的只读方式）、D99（表结构范围与值的表示），均按保守方案实现，用户 2026-10-22 确认。任务拆分见 [05 · v1.2 更多数据库](05-dev-plan.md#v12--更多数据库)。

## 1. 类型与驱动

`DbType`（08 §1）五个值，每个类型一个 `DbDriver`（03 §4.2 扩展点），由 `modules/databases/index.ts` 的 `DB_DRIVERS` 按类型组装；service 按连接的类型取驱动，按类型的 SQL 方言做语句检查（§4）。

| `DbType` | 界面名称 | 驱动 | 许可 | 体积（安装 / 打进后端包） | SQL 方言 |
| --- | --- | --- | --- | --- | --- |
| `mysql` | MySQL | mysql2 3.24.6（已有） | MIT | 4.9 MB / 约 1.4 MB | MySQL |
| `goldendb` | GoldenDB | 同上（MySQL 协议） | | — | MySQL |
| `postgresql` | PostgreSQL | pg 8.23.1 + pg-cursor 2.22.1 | MIT | 0.8 MB、15 个包 / 约 0.2 MB | PostgreSQL |
| `opengauss` | openGauss / GaussDB | gaussdb-node 0.2.2 + gaussdb-cursor 0.2.2（华为云 HuaweiCloudDeveloper 维护的 pg 分支） | MIT | 0.8 MB、15 个包 / 约 0.2 MB | PostgreSQL |
| `sqlserver` | SQL Server | tedious 20.3.8 | MIT | 70 MB、70 个包（大部分是 Azure 认证用的 `@azure/identity`、`@azure/msal-*`）/ 约 3.1 MB | T-SQL |

后端由 electron-vite 打成一个文件（`out/main/server.js`），安装包里没有 `node_modules`：上表「打进后端包」是实际增加的体积，`server.js` 从约 3.6 MB 增到 7.1 MB。

- **GoldenDB** 走 MySQL 协议，复用 mysql2 驱动与 MySQL 方言，作为独立类型列出（界面与 AI 看到的类型是 `goldendb`）。没有公开镜像，测试在 MySQL 容器上验证协议路径；GoldenDB 计算节点（DBProxy）是否支持 `START TRANSACTION READ ONLY` 与 `MAX_EXECUTION_TIME` 未在真实环境验证（§8）。
- **openGauss / GaussDB** 一个类型、一个驱动。openGauss 默认的密码认证是 sha256，pg 不支持（§6 实测），所以用华为的 pg 分支 gaussdb-node（D97）；它与 pg 的 API 相同，PostgreSQL 与 openGauss 共用一份驱动代码（`drivers/postgres.ts` 的 `createPostgresDriver`，只换客户端库）。
- **SQL Server** 用 tedious（mssql 包只是它之上的连接池封装，我们每次访问单独连接，不需要）。

## 2. 连接参数

字段与 MySQL 相同（11 §9）：名称、类型、主机、端口、数据库、用户名、密码、TLS 加密（`DbTlsMode`）。表单按类型给出默认端口（`DB_DEFAULT_PORT`，08 §4）：

| 类型 | 默认端口 | 说明（表单在类型下方显示） |
| --- | --- | --- |
| MySQL | 3306 | |
| PostgreSQL | 5432 | |
| openGauss / GaussDB | 5432 | GaussDB 的端口通常是 8000；支持 sha256 认证 |
| SQL Server | 1433 | 只支持 SQL Server 账号登录；没有只读事务（§4.3），建议只读账号 |
| GoldenDB | 3306 | 端口填计算节点（DBProxy）的端口 |

切换类型时，端口还是上一个类型的默认值就跟着换，用户改过的端口不变。

**TLS 加密**分三档（D166）：

| 档 | mysql2（MySQL / GoldenDB） | pg / gaussdb-node（PostgreSQL / openGauss） | tedious（SQL Server） |
| --- | --- | --- | --- |
| `off` 不加密 | 不传 `ssl` | `ssl: false` | `encrypt: false`（只加密登录包） |
| `verify` 加密并校验证书 | `ssl: {}` | `ssl: {}` | `encrypt: true` |
| `no_verify` 加密但不校验证书 | `ssl: { rejectUnauthorized: false }` | `ssl: { rejectUnauthorized: false }` | `encrypt: true, trustServerCertificate: true` |

`verify` 校验证书链与主机名，信任的是后端的默认 CA：内置根证书、`NODE_EXTRA_CA_CERTS`、系统证书库与设置 `network.extraCaCerts`（D164），企业 CA 签发、主机名正确的数据库证书这样就能校验。数据库自己生成的自签名证书（MySQL 默认证书没有主机名，PostgreSQL 镜像的 snakeoil、SQL Server 自动生成的证书）只能用 `no_verify`：传输加密，但不确认对方身份，界面写明可能被中间人冒充。不支持给单个连接附 CA 或只校验证书链、不校验主机名。

**不支持**：SQL Server 的 Windows / Azure AD 登录与命名实例（需 SQL Browser，请填端口）；PostgreSQL 的 Unix socket；按连接指定 schema（D99）。

## 3. 表结构读取

`tables` / `columns` / `indexes` 的范围是**连接的默认 schema**（D99）：MySQL / GoldenDB 为所填数据库；PostgreSQL / openGauss 为 `current_schema()`（通常是 `public`，openGauss 中与用户同名的 schema 存在时为它）；SQL Server 为 `SCHEMA_NAME()`（登录用户的默认 schema，通常是 `dbo`）。其他 schema 的表 AI 仍可在 `db_query` 中写全名查询。

| | MySQL / GoldenDB | PostgreSQL / openGauss | SQL Server |
| --- | --- | --- | --- |
| 表（含视图） | `information_schema.TABLES` | `pg_class`（`relkind` 为表、分区表、视图、物化视图、外部表） | `INFORMATION_SCHEMA.TABLES` |
| 表注释 | `TABLE_COMMENT` | `obj_description` | 扩展属性 `MS_Description` |
| 行数估计 | `TABLE_ROWS` | `reltuples`（从未 ANALYZE 的表为 -1，不返回；视图不返回） | `sys.partitions` 的行数之和（堆或聚集索引；视图不返回） |
| 列 | `information_schema.COLUMNS` | `pg_attribute` + `format_type` + `pg_get_expr`（默认值）+ `col_description` | `INFORMATION_SCHEMA.COLUMNS` + `MS_Description`；类型由 `DATA_TYPE` 与长度 / 精度拼成，如 `nvarchar(64)`、`varbinary(max)`、`decimal(10,2)` |
| `key` | `PRI` / `UNI` / `MUL`（`COLUMN_KEY`） | 只有 `PRI`（主键的键列：`indkey` 的前 `indnkeyatts` 个，`INCLUDE` 列不算） | 只有 `PRI` |
| 索引 | `information_schema.STATISTICS` | `pg_index` + `pg_get_indexdef(oid, n)` 逐列，只列前 `indnkeyatts` 个键列、不含 `INCLUDE` 列（表达式索引显示表达式；openGauss 只有 ustore 表的 ubtree 索引支持 `INCLUDE`）；用选择列表里的 `generate_series` 展开，不用 `LATERAL`（openGauss 基于 PostgreSQL 9.2） | `sys.indexes` + `sys.index_columns`（不含 `INCLUDE` 列；堆没有名称，不列） |

主键索引名各不相同：MySQL `PRIMARY`、PostgreSQL `<表>_pkey`、SQL Server 未命名时 `PK__<表>__<哈希>`。

## 4. 只读保证

四道关（12 §6.11）在每种数据库上的做法：

| 关 | MySQL / GoldenDB | PostgreSQL / openGauss | SQL Server |
| --- | --- | --- | --- |
| ① 单条语句 | 语句检查（只允许末尾一个分号）+ mysql2 关闭 `multipleStatements` | 语句检查 + 扩展查询协议（服务器拒绝一次多条命令） | 语句检查；T-SQL 的语句之间不需要分号，第二条语句只能靠关键字发现（§4.3） |
| ② 允许的语句（`DB_READ_ONLY_STATEMENTS`，08 §4；`db_query` 的工具说明与 MCP 工具页的文案由它生成） | `SELECT` `SHOW` `DESCRIBE` `DESC` `EXPLAIN` | `SELECT` `SHOW` `EXPLAIN` | `SELECT` |
| 另拒绝 | `INTO`、`FOR UPDATE` / `FOR SHARE`、`LOCK IN SHARE MODE`、`/*! */` 可执行注释 | `INTO`（`SELECT INTO` 建表）、`FOR [NO KEY] UPDATE`、`FOR [KEY] SHARE` | 会写入、执行代码、改变会话或事务、加锁的关键字（§4.3） |
| ③ 事务 | `START TRANSACTION READ ONLY`（写入被 1792 拒绝） | `START TRANSACTION READ ONLY`（写入被 SQLSTATE 25006 拒绝，例如调用会写入的函数、`nextval`） | `BEGIN TRANSACTION`，**从不提交**；连接关闭时服务器回滚 |
| ④ 时间 | `MAX_EXECUTION_TIME`（只管 SELECT）+ 稍长的客户端超时 | `SET LOCAL statement_timeout`（服务器中断任何语句，57014） | tedious 的 `requestTimeout`：到时发送 attention，服务器取消该批 |
| 行数 | 流式读取，读满即关闭连接 | 游标 `read(limit + 1)`：服务器只发出所需的行 | 流式读取，读满即取消请求（TDS attention，服务器停止发送），取消完成后关闭连接（随之回滚）；只读第一个结果集。不能在请求仍在传输时直接关闭连接：tedious 会在回调之外抛错 |

三种方言都不允许 `WITH` 开头：MySQL 与 PostgreSQL 允许 `WITH … UPDATE / DELETE`，统一拒绝，模型改写为子查询即可。

### 4.1 语句检查的词法

`databases.sql.ts` 的 `assertReadOnlySql(sql, type)` 先把引号内的文字与注释替换为空白，再检查分号、首关键字与禁止的子句。三种方言的词法不同，用错会误判：

| | MySQL | PostgreSQL / openGauss | T-SQL |
| --- | --- | --- | --- |
| 字符串与引号标识符 | `'…'` `"…"`（反斜杠转义）、`` `…` `` | `'…'`（反斜杠是普通字符）、`E'…'`（反斜杠转义）、`"…"`、`$tag$…$tag$` | `'…'`、`"…"`、`[…]`（`]]` 表示 `]`），没有反斜杠转义 |
| 行注释 | `#`、`-- `（后面须有空白） | `--`（`#` 是异或运算符） | `--` |
| 块注释 | 不嵌套；`/*! */` 会被执行，拒绝 | 可嵌套 | 可嵌套 |

行注释在 `\r` 或 `\n` 处结束：比服务器多看到代码只会多拒绝。PostgreSQL 一族有扩展查询协议兜底单条语句，词法只决定能否尽早给出清楚的错误；SQL Server 只有这一道，词法必须与服务器一致（单测覆盖 `[a;b]`、`N'…'`、`-- …\r` 等）。

### 4.2 PostgreSQL / openGauss

每次查询：连接 → `START TRANSACTION READ ONLY` → `SET LOCAL statement_timeout = <ms>` → 用游标（扩展协议）执行用户语句、读 `limit + 1` 行 → 关闭连接（事务随之结束，从不提交）。`EXPLAIN ANALYZE` 会真正执行语句，其中的写入同样被只读事务拒绝。

### 4.3 SQL Server（D98）

SQL Server 没有只读事务，也没有「只读会话」开关（`ApplicationIntent=ReadOnly` 只影响可用性组的路由）。做法：

1. **关键字拒绝表**：去掉引号文字与注释后，出现以下任一关键字（整词，不分大小写）即拒绝：`INTO INSERT UPDATE DELETE MERGE TRUNCATE DROP CREATE ALTER ADD EXEC EXECUTE BEGIN COMMIT ROLLBACK SAVE TRAN TRANSACTION GRANT REVOKE DENY USE SET DECLARE KILL SHUTDOWN BACKUP RESTORE DBCC BULK RECONFIGURE CHECKPOINT SETUSER REVERT OPENROWSET OPENQUERY OPENDATASOURCE WRITETEXT UPDATETEXT RECEIVE SEND CONVERSATION ENABLE DISABLE UPDLOCK XLOCK HOLDLOCK TABLOCK TABLOCKX`。其中大部分是保留字，作标识符时必须加引号（`[update]`），加了引号就不再是代码；`ENABLE`、`SEND` 等非保留字作为不加引号的列名时会被误拒，模型加方括号即可。
2. **语句以 `SELECT` 开头**，没有分号分隔的第二条语句。不带分号的第二条语句（`SELECT 1 DELETE FROM t`）由第 1 条拦下；剩下可能的第二条语句（`SELECT`、`WAITFOR`、`PRINT`、`IF` 等）不写数据。
3. **从不提交的事务**：整批在 `BEGIN TRANSACTION` 中执行，结束后关闭连接，服务器回滚。`COMMIT` / `ROLLBACK` / `SAVE` 已被第 1 条拒绝，批内无法提前结束事务。
4. **时间与行数**：见 §4 表。

**诚实的局限**（所以界面建议使用只读账号，如只属于 `db_datareader` 角色的用户）：

- 不随事务回滚的副作用拦不住：`NEXT VALUE FOR` 推进序列；自定义函数中调用的扩展存储过程；`tempdb` 的使用。
- 拒绝表是黑名单：未来版本新增的写入语法、我们漏掉的关键字可能通过；事务回滚是第二道防线，但挡不住上一条。
- 与 MySQL、PostgreSQL 共同的局限：有外部副作用的函数（PostgreSQL 的 `dblink`、`pg_terminate_backend`、咨询锁；MySQL 的 `GET_LOCK`、`SLEEP`）不受只读事务约束。只读账号是所有类型都推荐的做法。

## 5. 值与方言差异

查询结果按 JSON 返回（12 §6.11），各驱动的差异：

| | MySQL / GoldenDB | PostgreSQL / openGauss | SQL Server |
| --- | --- | --- | --- |
| 整数 | 数字 | 数字 | 数字 |
| `BIGINT` | 字符串 | 字符串 | 字符串 |
| `DECIMAL` / `NUMERIC` | 字符串 | 字符串 | **数字**（tedious 没有按字符串返回的选项，超过 2^53 的精度会丢失，D99） |
| 日期与时间 | 服务器文本 `2026-01-02 10:00:00` | 服务器文本（`timestamptz` 带时区偏移）；openGauss 默认的 A 兼容模式中 `DATE` 即 `timestamp(0)`，返回 `2026-01-02 00:00:00` | `DATE` → `2026-01-02`，`DATETIME` / `DATETIME2` → `2026-01-02 10:00:00.000`（毫秒精度），`DATETIMEOFFSET` → ISO（UTC） |
| 二进制 | `0x…` 十六进制（最多 64 字节） | 同左（`bytea`） | 同左 |
| 布尔 / JSON / 数组 | `TINYINT` 数字 / 字符串 | 布尔 / 对象 / 数组 | `BIT` 为布尔 |

写 SQL 时的方言差异（AI 从 `db_list_connections` 的 `type` 得知方言；`db_query` 的说明列出每种类型允许的语句；知识问答的首条消息在连接名后标出类型）：

| | MySQL / GoldenDB | PostgreSQL / openGauss | SQL Server |
| --- | --- | --- | --- |
| 标识符引号 | `` `name` `` | `"name"`（不加引号时折叠为小写） | `[name]` 或 `"name"` |
| 限制行数 | `LIMIT n` | `LIMIT n` | `TOP n` / `OFFSET … FETCH` |
| 查看表结构 | `SHOW` / `DESCRIBE` | 不支持 `DESCRIBE`，用 `db_describe` | 用 `db_describe` |

## 6. openGauss / GaussDB 的认证（D97 实测）

openGauss 的口令存储方式由 `password_encryption_type` 决定：0 为 md5、1 为 md5 + sha256、**2 为只存 sha256（默认）**；`pg_hba.conf` 中对应 `md5` 或 `sha256`。它的 sha256 认证请求码是 10，与 PostgreSQL 的 SASL（SCRAM）相同，pg 会按 SCRAM 解析而失败。

用镜像 `opengauss/opengauss-server:7.0.0-RC3.B025`（arm64 与 amd64；`opengauss/opengauss:latest` 的 arm64 版本缺 `libopenblas.so.0` 无法启动）实测：

| 服务器配置 | pg 8.23.1 | gaussdb-node 0.2.2 |
| --- | --- | --- |
| 镜像自带：`password_encryption_type = 0` + `host … md5` | 成功 | 成功 |
| 默认安装：`password_encryption_type = 2` + `host … sha256` | 失败：`SASL: Only mechanism(s) SCRAM-SHA-256 are supported` | 成功 |
| 只存 sha256 的口令 + `host … md5` | 失败：`Cannot read properties of undefined (reading 'message')` | 同左失败 |

注意镜像本身把服务器改成了 md5，用它测 pg 会得出「能连」的错误结论；集成测试的 openGauss 容器以 `GS_HOST_AUTH_METHOD=sha256`、`password_encryption_type = 2` 启动，与默认安装一致。

若只用 pg，用户的 DBA 需要：把 `password_encryption_type` 改为 1（或 0）、**重设**该用户的密码（使服务器另存 md5 散列）、在 `pg_hba.conf` 中为应用所在主机配置 `md5`。这降低了口令存储强度，很多环境不允许，所以 D97 选用 gaussdb-node。上表第三行（服务器只存 sha256 却要求 md5）两个驱动都失败，且错误信息难懂：测试连接直接显示驱动信息，界面说明中提示 sha256 认证可用。

## 7. 测试

| 层 | 文件 | 内容 |
| --- | --- | --- |
| 单元 | `databases.sql.test.ts` | 三种方言各自的放行与拒绝（引号、注释、美元引号、方括号、不带分号的第二条语句、拒绝表） |
| 集成 | `databases.int.test.ts` | MySQL 8.4（原有）；GoldenDB 类型的连接指向同一个 MySQL 容器：测试连接、浏览、只读事务拒绝写入的函数 |
| 集成 | `databases.engines.int.test.ts` | PostgreSQL 17.6、openGauss 7（只用 sha256 认证）、SQL Server 2022，表驱动的同一组用例：测试连接与版本、浏览表结构（注释、行数、列、主键）、`db_describe` 的列与索引、值的 JSON 表示、`limit` 截断、写语句被拒绝（PostgreSQL 一族另测会写入的函数被只读事务拒绝）、超时、SQL 错误 |
| E2E | `pro-databases.browser.spec.ts`（J21） | 浏览器：添加 PostgreSQL 连接（切换类型后端口变为 5432）→ 测试连接显示版本 → 浏览表结构 → 关联项目 → 知识问答勾选数据库，研究员（FakeOpencode）调用 `db_query` 并引用 → 打开引用看到在 PostgreSQL 上重新执行的行 |

容器镜像需要先拉取：

```bash
docker pull mysql:8.4
docker pull postgres:17.6
docker pull opengauss/opengauss-server:7.0.0-RC3.B025
docker pull mcr.microsoft.com/mssql/server:2022-latest
```

MySQL 为必需（`pnpm verify`，与原来相同）。另外三个镜像没有拉取时，对应的集成测试与 J21 跳过并打印需要执行的 `docker pull`；SQL Server 镜像只有 amd64，Apple 芯片上经 Rosetta 运行（Docker Desktop 默认开启），启动较慢。CI（手动运行）在 Ubuntu 上拉取全部四个镜像；Windows 与 macOS runner 不能运行 Linux 容器，排除两个数据库集成测试文件（17 §4.1）。

## 8. 不做与已知限制

- GoldenDB 没有在真实环境验证：DBProxy 若不支持 `SET SESSION MAX_EXECUTION_TIME` 或只读事务，查询会失败（`DB_QUERY_FAILED`，带驱动信息），届时为 GoldenDB 单独写一个 mysql2 驱动变体。
- GaussDB（华为云的集中式与分布式版本）没有验证，只验证了 openGauss 7；两者的认证与系统表相同。
- 只浏览默认 schema（D99）。
- SQL Server：只支持 SQL Server 账号；`DECIMAL` 为数字（§5）；只读依赖拒绝表与回滚（§4.3）。
- 不做写操作（D07 不变）。
