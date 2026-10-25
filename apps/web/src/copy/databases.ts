import type { DbTlsMode, DbType } from '@aw/shared';

export const DATABASES_COPY = {
  title: '数据库',
  lede: '项目的 AI 会话可以只读查询关联的数据库：每次只允许一条只读查询，在只读事务中执行（SQL Server 为不提交的事务），限制行数与时间。密码加密保存，不会发给 AI。',
  add: '添加连接',
  addTitle: '添加数据库连接',
  editTitle: (name: string) => `修改「${name}」`,
  empty: '还没有数据库连接',
  emptyBody: '添加连接后，在项目详情里把它关联给项目。',
  type: '类型',
  typeLabel: {
    mysql: 'MySQL',
    postgresql: 'PostgreSQL',
    opengauss: 'openGauss / GaussDB',
    sqlserver: 'SQL Server',
    goldendb: 'GoldenDB',
  } satisfies Record<DbType, string>,
  /** Below the type select: what differs for that database (24 §2). */
  typeHint: {
    mysql: '浏览表结构时显示所填数据库中的表。',
    postgresql: '浏览表结构时显示当前 schema（通常是 public）中的表；其他 schema 可在查询中写全名。',
    opengauss: '支持 openGauss 默认的 sha256 密码认证。GaussDB 的端口通常是 8000。浏览表结构时显示当前 schema 中的表。',
    sqlserver:
      '只支持 SQL Server 账号登录。SQL Server 没有只读事务：查询在不提交的事务中执行，并拒绝任何会写入的关键字；建议使用只有读取权限的账号（如 db_datareader）。浏览表结构时显示默认 schema（通常是 dbo）中的表。',
    goldendb: '按 MySQL 协议连接，端口填计算节点（DBProxy）的端口。',
  } satisfies Record<DbType, string>,
  name: '名称',
  nameHint: 'AI 按这个名称使用连接',
  host: '主机',
  port: '端口',
  database: '数据库',
  username: '用户名',
  password: '密码',
  passwordKeep: '留空表示不修改',
  tls: 'TLS 加密',
  tlsLabel: {
    off: '不加密',
    verify: '加密并校验证书',
    no_verify: '加密但不校验证书',
  } satisfies Record<DbTlsMode, string>,
  /** Below the TLS select (24 §2, D166). */
  tlsHint: {
    off: '账号、密码与查询结果以明文传输。',
    verify:
      '校验服务器证书与主机名。证书由企业 CA 签发时，CA 要在系统证书库里，或加到设置「网络」的「额外信任的 CA 证书」。',
    no_verify:
      '传输加密，但不确认对方是不是这台数据库，可能被冒充（中间人）。用于数据库自己生成的自签名证书（如 MySQL 默认证书）。',
  } satisfies Record<DbTlsMode, string>,
  tlsChip: {
    verify: 'TLS',
    no_verify: 'TLS · 不校验证书',
  } satisfies Record<Exclude<DbTlsMode, 'off'>, string>,
  test: '测试连接',
  testOk: (version: string) => `连接成功 · 服务器版本 ${version}`,
  testFailed: (error: string) => `连接失败：${error}`,
  schema: '浏览表结构',
  schemaTitle: (name: string) => `${name} 的表结构`,
  schemaEmpty: '这个数据库没有表。',
  rows: (n: number) => `约 ${n} 行`,
  nullable: '可空',
  edit: '修改',
  delete: '删除',
  deleteTitle: (name: string) => `删除连接「${name}」？`,
  deleteBody: '保存的密码会一起删除，关联它的项目将不再能查询它。',
  deleted: '连接已删除',
  saved: '连接已保存',
  projectSection: '关联数据库',
  projectHint: '这个项目的 AI 会话可以只读查询勾选的数据库。',
  projectNone: '还没有数据库连接，先到「数据库」页面添加。',
  projectSaved: '已更新关联的数据库',
} as const;
