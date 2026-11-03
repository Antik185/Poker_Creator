'use strict';

// Private staging only. Does not modify or reload the production reverse proxy.
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const directory = path.resolve(process.argv[2]);
const server = https.createServer({ key: fs.readFileSync(path.join(directory, 'tls-key.pem')),
  cert: fs.readFileSync(path.join(directory, 'tls-cert.pem')), minVersion: 'TLSv1.2' }, (req, res) => {
  const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' };
  const upstream = http.request({ host: '127.0.0.1', port: 3301, path: req.url, method: req.method, headers }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(3301, '127.0.0.1', () => {
    const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-for': '127.0.0.1' };
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`
      + Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join('') + '\r\n');
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
});
server.listen(3443, '127.0.0.1', () => console.log('Private staging TLS proxy listening on 127.0.0.1:3443'));
