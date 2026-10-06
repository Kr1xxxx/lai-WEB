// Serve one rebuilt web trial page for local browser checks.
//   node scripts/web-trial/serve.cjs /path/to/lai-web.html [port]
// The file is re-read on every request, so rebuilding does not need a restart.
const http = require('http'), fs = require('fs');
const file = process.argv[2], port = Number(process.argv[3] || 8766);
if (!file) { console.error('usage: node serve.cjs <page.html> [port]'); process.exit(2); }
http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(file));
}).listen(port, '127.0.0.1', () => console.log(`serving ${file} at http://127.0.0.1:${port}/`));
