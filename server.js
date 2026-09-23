const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const types = { '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html' };

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  const relativePath = urlPath.replace(/^[/\\]+/, '') || 'index.html';
  const filePath = path.resolve(publicDir, relativePath);
  const relativeFilePath = path.relative(publicDir, filePath);

  if (relativeFilePath === '..' || relativeFilePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativeFilePath)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      return res.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
    }
    res.writeHead(200, { 'Content-Type': `${types[path.extname(filePath)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(content);
  });
});

server.listen(port, () => console.log(`Artas is running at http://localhost:${port}`));
