const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const file = process.argv[2];
const html = { file, type: 'text/html; charset=utf-8' };
const routes = new Map([
  ['/', html],
  ['/Prototipo.html', html],
  ['/InterVariable.woff2', {
    file: path.join(path.dirname(file), 'InterVariable.woff2'),
    type: 'font/woff2',
    cache: 'max-age=86400',
  }],
]);
const server = http.createServer((request, response) => {
  const asset = routes.get(request.url.split('?')[0]);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  fs.readFile(asset.file, (error, content) => {
    if (error) {
      response.writeHead(500).end('Arquivo indisponivel');
      return;
    }
    response.writeHead(200, {'Content-Type': asset.type, 'Cache-Control': asset.cache ?? 'no-store'}).end(content);
  });
});
server.listen(4173, 'localhost');
