import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

// Dispatch real Express middleware without opening TCP ports (sandbox-compatible).
export function dispatch(app, path, token, body) {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    Object.defineProperty(socket, 'remoteAddress', { value: '127.0.0.1' });
    const req = new IncomingMessage(socket);
    req.method = body === undefined ? 'GET' : 'POST'; req.url = `/api/${path}`;
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    req.headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(bytes ? { 'content-type': 'application/json', 'content-length': String(bytes.length) } : {}) };
    const res = new ServerResponse(req), chunks = [];
    res.write = chunk => { if (chunk) chunks.push(Buffer.from(chunk)); return true; };
    res.end = chunk => {
      if (chunk) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      res.emit('finish'); socket.destroy();
      try { resolve({ status: res.statusCode, data: text ? JSON.parse(text) : null }); } catch (e) { reject(e); }
      return res;
    };
    app(req, res);
    if (bytes) req.push(bytes);
    req.push(null);
  });
}
