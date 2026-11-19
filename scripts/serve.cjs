const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'public');
const routes = new Map([
  ["/",["index.html","text/html; charset=utf-8"]],
  ["/index.html",["index.html","text/html; charset=utf-8"]],
  ["/Prototipo.html",["index.html","text/html; charset=utf-8"]],
  ["/assets/css/app.css",["assets/css/app.css","text/css; charset=utf-8"]],
  ["/assets/css/auth.css",["assets/css/auth.css","text/css; charset=utf-8"]],
  ["/assets/css/transactions.css",["assets/css/transactions.css","text/css; charset=utf-8"]],
  ["/assets/css/stitch-home.css",["assets/css/stitch-home.css","text/css; charset=utf-8"]],
  ["/assets/js/app.js",["assets/js/app.js","text/javascript; charset=utf-8"]],
  ["/assets/images/FinFlow-avatar.jpg",["assets/images/FinFlow-avatar.jpg","image/jpeg"]],
  ["/assets/fonts/InterVariable.woff2",["assets/fonts/InterVariable.woff2","font/woff2"]],
  ["/assets/fonts/HankenGrotesk.woff2",["assets/fonts/HankenGrotesk.woff2","font/woff2"]],
  ["/assets/fonts/PlusJakartaSans.woff2",["assets/fonts/PlusJakartaSans.woff2","font/woff2"]],
  ["/assets/fonts/MaterialSymbols.woff2",["assets/fonts/MaterialSymbols.woff2","font/woff2"]],
  ["/assets/fonts/AuthSymbols.woff2",["assets/fonts/AuthSymbols.woff2","font/woff2"]],
]);
const server = http.createServer((request, response) => {
  const asset = routes.get(request.url.split('?')[0]);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  fs.readFile(path.join(root, asset[0]), (error, content) => {
    if (error) {
      response.writeHead(500).end('Arquivo indisponivel');
      return;
    }
    response.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' }).end(content);
  });
});
server.listen(4173, 'localhost', () => console.log('FinFlow: http://localhost:4173'));
