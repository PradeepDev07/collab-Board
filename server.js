// Real-Time Collaboration Board server (Node.js + ws)
// Static file server + WebSocket backend

const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.error('\nMissing dependency: "ws".\nInstall it with:\n  npm init -y && npm i ws\n');
  // Defer throwing so the static server can still run if desired
}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- In-memory state ----
const tasks = new Map(); // id -> task
const users = new Map(); // clientId -> username

const genId = () => Math.random().toString(36).slice(2, 10);

// ---- Static file server ----
const CONTENT_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveFile(req, res) {
  const parsed = url.parse(req.url);
  const pathname = decodeURIComponent(parsed.pathname || '/');
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(PUBLIC_DIR, '.' + requested);

  // Prevent path traversal escaping PUBLIC_DIR
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const ct = CONTENT_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(serveFile);

// ---- WebSocket server ----
let wss = null;
const socketClientIds = new WeakMap(); // ws -> clientId

function broadcast(obj, opts = {}) {
  if (!wss) return;
  const json = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (opts.exclude && client === opts.exclude) continue;
    if (client.readyState === WebSocket.OPEN) client.send(json);
  }
}

function toUsersArray() {
  return Array.from(users, ([id, username]) => ({ id, username }));
}

function handleMessage(ws, clientId, data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch (e) {
    return;
  }

  const username = users.get(clientId) || 'Unknown';

  switch (msg.type) {
    case 'join': {
      const name = (msg.username || '').toString().trim() || `User-${clientId.slice(0, 4)}`;
      users.set(clientId, name);
      // Send current state to the new client
      ws.send(
        JSON.stringify({
          type: 'init_state',
          yourId: clientId,
          username: name,
          tasks: Array.from(tasks.values()),
          users: toUsersArray(),
        })
      );
      // Notify others
      broadcast({ type: 'users_update', users: toUsersArray() }, { exclude: ws });
      broadcast({ type: 'activity', message: `${name} joined` }, { exclude: null });
      break;
    }

    case 'add_task': {
      const id = genId();
      const title = (msg.title || '').toString().trim();
      if (!title) return;
      const description = (msg.description || '').toString();
      const status = ['todo', 'in_progress', 'done'].includes(msg.status) ? msg.status : 'todo';
      const task = {
        id,
        title,
        description,
        createdBy: username,
        assignedTo: msg.assignedTo || null,
        status,
        createdAt: Date.now(),
      };
      tasks.set(id, task);
      broadcast({ type: 'add_task', task });
      broadcast({ type: 'activity', message: `${username} created Task #${id}: ${title}` });
      break;
    }

    case 'move_task': {
      const { taskId, to } = msg;
      const task = tasks.get(taskId);
      if (!task) return;
      const valid = ['todo', 'in_progress', 'done'];
      if (!valid.includes(to)) return;
      const from = task.status;
      if (from === to) return;
      task.status = to;
      tasks.set(taskId, task);
      broadcast({ type: 'move_task', taskId, from, to, movedBy: username });
      broadcast({ type: 'activity', message: `${username} moved Task #${taskId} ${from} → ${to}` });
      break;
    }

    case 'edit_task': {
      const { taskId, title, description, assignedTo } = msg;
      const task = tasks.get(taskId);
      if (!task) return;
      if (typeof title === 'string') task.title = title.trim();
      if (typeof description === 'string') task.description = description;
      if (typeof assignedTo === 'string' || assignedTo === null) task.assignedTo = assignedTo;
      tasks.set(taskId, task);
      broadcast({ type: 'update_task', task });
      broadcast({ type: 'activity', message: `${username} edited Task #${taskId}` });
      break;
    }

    case 'delete_task': {
      const { taskId } = msg;
      const existed = tasks.get(taskId);
      tasks.delete(taskId);
      if (existed) {
        broadcast({ type: 'delete_task', taskId });
        broadcast({ type: 'activity', message: `${username} deleted Task #${taskId}` });
      }
      break;
    }

    default:
      break;
  }
}

if (WebSocket) {
  wss = new WebSocket.Server({ server });
  wss.on('connection', (ws) => {
    const clientId = genId();
    socketClientIds.set(ws, clientId);

    ws.on('message', (data) => handleMessage(ws, clientId, data));

    ws.on('close', () => {
      const id = socketClientIds.get(ws);
      const name = users.get(id);
      users.delete(id);
      broadcast({ type: 'users_update', users: toUsersArray() });
      if (name) broadcast({ type: 'activity', message: `${name} left` });
    });

    ws.on('error', () => {/* noop */});
  });
}

server.listen(PORT, HOST, () => {
  console.log(`\nReal-Time Collaboration Board server running at http://${HOST}:${PORT}`);
  console.log('Open your browser to http://localhost:' + PORT);
  if (!WebSocket) {
    console.log('\nNote: WebSocket functionality requires installing "ws" (npm i ws).');
  }
});

