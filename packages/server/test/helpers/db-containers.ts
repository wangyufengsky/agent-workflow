import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import gaussdb from 'gaussdb-node';
import mysql from 'mysql2/promise';
import pg from 'pg';
import { Connection, Request } from 'tedious';
import type { TestCertificates } from './tls.ts';

const run = promisify(execFile);

/**
 * The images of the database integration tests (07 §2: real dependencies; 24 §6). They are pulled beforehand with
 * `docker pull`; MySQL is required, the others are skipped with a notice when missing (`imageAvailable`).
 */
export const DB_IMAGE = {
  mysql: 'mysql:8.4',
  postgres: 'postgres:17.6',
  opengauss: 'opengauss/opengauss-server:7.0.0-RC3.B025',
  sqlserver: 'mcr.microsoft.com/mssql/server:2022-latest',
} as const;

/** First start initialises the data directory; SQL Server runs emulated on Apple silicon. */
const READY_TIMEOUT_MS = 180_000;
/** The name of the empty database each server gets. */
const DATABASE = 'shop';

export type TestDatabase = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** Runs statements as the administrator (several per call, except SQL Server: one batch per call). */
  exec(sql: string): Promise<void>;
  stop(): Promise<void>;
};

/** Whether the image is pulled; a test of a missing optional engine is skipped with this notice. */
export async function imageAvailable(image: string): Promise<boolean> {
  try {
    await run('docker', ['image', 'inspect', image]);
    return true;
  } catch {
    console.warn(`[db-containers] ${image} is not pulled; its tests are skipped. Run: docker pull ${image}`);
    return false;
  }
}

/** Resolves once `command`'s output matches `ready`. */
function outputMatches(command: string[], ready: RegExp, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const [bin = 'docker', ...args] = command;
    const child = spawn(bin, args);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${what} was not ready within ${READY_TIMEOUT_MS} ms`));
    }, READY_TIMEOUT_MS);
    let seen = '';
    const onData = (chunk: Buffer) => {
      seen += chunk.toString('utf8');
      if (!ready.test(seen)) return;
      clearTimeout(timer);
      child.kill();
      resolve();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

type ContainerSpec = {
  image: string;
  env: Record<string, string>;
  port: number;
  /**
   * When the server accepts connections: a line of its log, or (for a server that logs to files) Docker's health check
   * passing, reported as an event.
   */
  ready: { log: RegExp } | { healthCmd: string };
  /** `-v` mounts, `host:container[:ro]`. */
  volumes?: string[];
  /** Arguments after the image: options of the server command. */
  command?: string[];
};

/** Starts the container on a random local port and waits until it is ready; returns its id and port. */
async function startContainer({ image, env, port, ready, volumes = [], command = [] }: ContainerSpec) {
  const health = 'healthCmd' in ready ? ['--health-cmd', ready.healthCmd, '--health-interval', '1s'] : [];
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const { stdout } = await run('docker', [
    'run',
    '-d',
    '--rm',
    ...envArgs,
    ...health,
    ...volumes.flatMap((v) => ['-v', v]),
    '-p',
    `127.0.0.1::${port}`,
    image,
    ...command,
  ]);
  const id = stdout.trim();
  if ('log' in ready) await outputMatches(['docker', 'logs', '-f', id], ready.log, `${image} in ${id}`);
  else {
    const events = ['docker', 'events', '--filter', `container=${id}`, '--filter', 'event=health_status'];
    await outputMatches(events, /health_status: healthy/, `${image} in ${id}`);
  }
  const mapped = (await run('docker', ['port', id, `${port}/tcp`])).stdout.trim();
  return {
    port: Number(mapped.split(':').at(-1)),
    stop: async () => {
      await run('docker', ['rm', '-f', id]);
    },
  };
}

/**
 * MySQL 8.4 with an empty database `shop`. Its TLS certificate is the one it generates itself (no host name, its own
 * CA), or the server certificate of `certificates` (D166).
 */
export async function startMysql(certificates?: TestCertificates): Promise<TestDatabase> {
  const password = 'aw-test-root';
  const { port, stop } = await startContainer({
    image: DB_IMAGE.mysql,
    env: { MYSQL_ROOT_PASSWORD: password, MYSQL_DATABASE: DATABASE },
    port: 3306,
    // The entrypoint first runs a temporary server without networking; the real one reports this port.
    ready: { log: /ready for connections.*port: 3306\b/ },
    ...(certificates === undefined
      ? {}
      : {
          volumes: [`${certificates.dir}:/certs:ro`],
          command: ['--ssl-ca=/certs/ca.pem', '--ssl-cert=/certs/server.pem', '--ssl-key=/certs/server-key.pem'],
        }),
  });
  const options = { host: '127.0.0.1', port, user: 'root', password, database: DATABASE, multipleStatements: true };
  return {
    host: options.host,
    port,
    database: DATABASE,
    username: options.user,
    password,
    async exec(sql) {
      const connection = await mysql.createConnection(options);
      try {
        await connection.query(sql);
      } finally {
        await connection.end();
      }
    },
    stop,
  };
}

/** A pg-compatible server's `exec` through the given client library. */
function pgExec(Client: typeof pg.Client, config: pg.ClientConfig) {
  return async (sql: string) => {
    const client = new Client(config);
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };
}

/** PostgreSQL 17 with an empty database `shop`; TLS with the image's self-signed certificate (`ssl-cert-snakeoil`). */
export async function startPostgres(): Promise<TestDatabase> {
  const password = 'aw-test-root';
  const { port, stop } = await startContainer({
    image: DB_IMAGE.postgres,
    env: { POSTGRES_PASSWORD: password, POSTGRES_DB: DATABASE },
    port: 5432,
    // The temporary server of the first start also reports ready, before this line.
    ready: { log: /init process complete[\s\S]*ready to accept connections/ },
    command: [
      ...['-c', 'ssl=on', '-c', 'ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem'],
      ...['-c', 'ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key'],
    ],
  });
  const config = { host: '127.0.0.1', port, user: 'postgres', password, database: DATABASE };
  return { ...config, username: config.user, exec: pgExec(pg.Client, config), stop };
}

/**
 * openGauss 7 with an empty database `shop`. Passwords are stored and checked as sha256 only, the server's default
 * that pg cannot log in with (D97); the image would otherwise switch to md5.
 */
export async function startOpenGauss(): Promise<TestDatabase> {
  const password = 'Aw-test#2026';
  const { port, stop } = await startContainer({
    image: DB_IMAGE.opengauss,
    env: { GS_PASSWORD: password, GS_HOST_AUTH_METHOD: 'sha256', OTHER_PG_CONF: 'password_encryption_type = 2' },
    port: 5432,
    // The server logs to files. The entrypoint's temporary server also listens, but PID 1 becomes gaussdb only after.
    ready: {
      healthCmd: `[ "$(cat /proc/1/comm)" = gaussdb ] && su - omm -c "gsql -d postgres -c 'SELECT 1'"`,
    },
  });
  const config = { host: '127.0.0.1', port, user: 'gaussdb', password, database: DATABASE };
  await pgExec(gaussdb.Client, { ...config, database: 'postgres' })(`CREATE DATABASE ${DATABASE}`);
  return { ...config, username: config.user, exec: pgExec(gaussdb.Client, config), stop };
}

/** One batch on SQL Server as `sa`. */
function tsqlExec(port: number, password: string, database: string) {
  return async (sql: string) => {
    const connection = new Connection({
      server: '127.0.0.1',
      authentication: { type: 'default', options: { userName: 'sa', password } },
      options: { port, database, encrypt: false },
    });
    await new Promise<void>((resolve, reject) => connection.connect((err) => (err ? reject(err) : resolve())));
    try {
      await new Promise<void>((resolve, reject) => {
        connection.execSqlBatch(new Request(sql, (err) => (err ? reject(err) : resolve())));
      });
    } finally {
      connection.close();
    }
  };
}

/** SQL Server 2022 (Developer edition) with an empty database `shop`; TLS with the certificate it generates itself. */
export async function startSqlServer(): Promise<TestDatabase> {
  const password = 'Aw-test#2026';
  const { port, stop } = await startContainer({
    image: DB_IMAGE.sqlserver,
    env: { ACCEPT_EULA: 'Y', MSSQL_SA_PASSWORD: password, MSSQL_PID: 'Developer' },
    port: 1433,
    // "ready for client connections" comes before the system databases are recovered; logins fail until this line.
    ready: { log: /Recovery is complete/ },
  });
  await tsqlExec(port, password, 'master')(`CREATE DATABASE ${DATABASE}`);
  return {
    host: '127.0.0.1',
    port,
    database: DATABASE,
    username: 'sa',
    password,
    exec: tsqlExec(port, password, DATABASE),
    stop,
  };
}
