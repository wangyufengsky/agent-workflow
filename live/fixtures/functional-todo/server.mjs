import { createServer } from 'node:http';

const item = '/api/todos/fixture-1';

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/healthz') {
    res.statusCode = process.env.NODE_ENV === 'qa' ? 200 : 503;
    res.end(JSON.stringify({ profile: process.env.NODE_ENV }));
    return;
  }
  if (req.method === 'POST' && req.url === '/api/check') {
    const body = await readBody(req);
    const accepted = body.done === true;
    res.statusCode = accepted ? 200 : 400;
    res.end(JSON.stringify({ accepted }));
    return;
  }
  if (req.method === 'PATCH' && req.url === item) {
    const body = await readBody(req);
    // 夹具中的缺陷是更新接口确认接收，读取接口却未保留该状态。
    res.end(JSON.stringify({ done: body.done }));
    return;
  }
  res.end(JSON.stringify({ done: false }));
}).listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
