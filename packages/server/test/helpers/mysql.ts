import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';

const run = promisify(execFile);

/** The MySQL image of the database integration tests (07 §2: real dependencies; M5-07). */
const MYSQL_IMAGE = 'mysql:8.4';
/** First start initialises the data directory; the image is pulled beforehand by `docker pull`. */
const READY_TIMEOUT_MS = 120_000;
/** The entrypoint first runs a temporary server without networking; the real one reports this port. */
const READY_LINE = /ready for connections.*port: 3306\b/;

export type TestMysql = {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** Runs statements as root (several per call). */
  exec(sql: string): Promise<void>;
  stop(): Promise<void>;
};

/** Resolves once the container's log says the server accepts TCP connections. */
function readyForConnections(containerId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const logs = spawn('docker', ['logs', '-f', containerId]);
    const timer = setTimeout(() => {
      logs.kill();
      reject(new Error(`MySQL in ${containerId} was not ready within ${READY_TIMEOUT_MS} ms`));
    }, READY_TIMEOUT_MS);
    let seen = '';
    const onData = (chunk: Buffer) => {
      seen += chunk.toString('utf8');
      if (!READY_LINE.test(seen)) return;
      clearTimeout(timer);
      logs.kill();
      resolve();
    };
    logs.stdout.on('data', onData);
    logs.stderr.on('data', onData);
  });
}

/** A fresh MySQL server in Docker with an empty database `shop`, on a random local port. */
export async function startMysql(): Promise<TestMysql> {
  const password = 'aw-test-root';
  const database = 'shop';
  const { stdout } = await run('docker', [
    'run',
    '-d',
    '--rm',
    '-e',
    `MYSQL_ROOT_PASSWORD=${password}`,
    '-e',
    `MYSQL_DATABASE=${database}`,
    '-p',
    '127.0.0.1::3306',
    MYSQL_IMAGE,
  ]);
  const containerId = stdout.trim();
  await readyForConnections(containerId);
  const mapped = (await run('docker', ['port', containerId, '3306/tcp'])).stdout.trim();
  const port = Number(mapped.split(':').at(-1));
  const options = { host: '127.0.0.1', port, user: 'root', password, database, multipleStatements: true };
  return {
    host: options.host,
    port,
    database,
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
    async stop() {
      await run('docker', ['rm', '-f', containerId]);
    },
  };
}
