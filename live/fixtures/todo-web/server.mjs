// A dev server without dependencies: serves the files of public/ on PORT.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const port = Number(process.env.PORT ?? 3000);

createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : (req.url ?? '/');
  try {
    const body = await readFile(join(import.meta.dirname, 'public', path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`todo-web on http://127.0.0.1:${port}`));
