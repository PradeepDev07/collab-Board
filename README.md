# Real-Time Collaboration Board (Vanilla JS + WebSockets)

A Trello-like Kanban board with real-time sync via WebSockets, built with vanilla JS on the frontend and a Node.js server using the `ws` library.

## Features
- Basic username auth (join with a name, see online users)
- Three columns (To Do, In Progress, Done)
- Create, edit, delete tasks
- Drag & drop tasks between columns
- Real-time updates and activity log
- In-memory persistence

## Getting started

1. Install dependencies:

```sh
npm init -y
npm i ws
```

2. Run the server:

```sh
node server.js
```

3. Open the app in your browser:

- http://localhost:3000

4. Use it in multiple tabs to see real-time collaboration.

## Project structure

```
.
├─ server.js            # Static file + WebSocket server
└─ public/
   ├─ index.html        # UI layout
   ├─ style.css         # Styling
   └─ app.js            # Client logic (WebSocket + DOM + DnD)
```

## Message protocol (examples)

- add_task
- move_task
- edit_task
- delete_task
- users_update
- activity
- init_state

See `server.js` and `public/app.js` for payload details.

## Next steps / Enhancements
- Add persistence via a database (MongoDB/Postgres)
- Add user presence indicators on cards
- Add per-task comments
- Add optimistic UI and reconnection logic
- Add tests (e.g., using Playwright for e2e or node/ws for server unit tests)

