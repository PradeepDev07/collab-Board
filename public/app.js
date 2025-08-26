(() => {
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  const wsUrl = () => {
    const { protocol, host } = window.location; // host includes :port if present
    const wsProto = protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProto}://${host}`;
  };

  let ws = null;
  let myId = null;
  let myName = localStorage.getItem('username') || '';

  // UI refs
  const usernameInput = $('#usernameInput');
  const joinBtn = $('#joinBtn');
  const onlineUsersEl = $('#onlineUsers');
  const activityEl = $('#activityLog');
  const newTaskForm = $('#newTaskForm');
  const taskTitle = $('#taskTitle');
  const taskDesc = $('#taskDesc');
  const taskStatus = $('#taskStatus');

  // Columns
  const columns = {
    todo: $('#col-todo'),
    in_progress: $('#col-in_progress'),
    done: $('#col-done'),
  };

  // Init inputs
  usernameInput.value = myName;

  function connect() {
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      if (myName) join();
    });
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', () => logActivity('Disconnected'));
  }

  function join() {
    myName = usernameInput.value.trim() || `User-${Math.random().toString(36).slice(2,6)}`;
    localStorage.setItem('username', myName);
    send({ type: 'join', username: myName });
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  function onMessage(evt) {
    const msg = JSON.parse(evt.data);
    switch (msg.type) {
      case 'init_state': {
        myId = msg.yourId;
        renderUsers(msg.users);
        renderAllTasks(msg.tasks);
        logActivity(`You joined as ${msg.username}`);
        break;
      }
      case 'users_update':
        renderUsers(msg.users);
        break;
      case 'activity':
        logActivity(msg.message);
        break;
      case 'add_task':
        renderTask(msg.task);
        break;
      case 'update_task':
        renderTask(msg.task, { replace: true });
        break;
      case 'delete_task':
        removeTask(msg.taskId);
        break;
      case 'move_task':
        moveTask(msg.taskId, msg.to, true);
        logActivity(`${msg.movedBy} moved #${msg.taskId} to ${msg.to}`);
        break;
    }
  }

  function renderUsers(users) {
    onlineUsersEl.innerHTML = '';
    users.forEach(u => {
      const li = document.createElement('li');
      li.textContent = u.username + (u.id === myId ? ' (you)' : '');
      onlineUsersEl.appendChild(li);
    });
  }

  function logActivity(text) {
    const li = document.createElement('li');
    li.textContent = new Date().toLocaleTimeString() + ' • ' + text;
    activityEl.prepend(li);
  }

  function taskCardEl(task) {
    const el = document.createElement('div');
    el.className = 'card';
    el.setAttribute('draggable', 'true');
    el.dataset.id = task.id;
    el.innerHTML = `
      <div class="card-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="card-desc">${escapeHtml(task.description)}</div>` : ''}
      <div class="card-meta">
        <span>#${task.id}</span>
        <span>${task.createdBy}${task.assignedTo ? ' → ' + task.assignedTo : ''}</span>
      </div>
      <div class="card-actions">
        <button data-action="edit">Edit</button>
        <button data-action="delete">Delete</button>
      </div>
    `;

    // desktop drag handlers
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.setData('text/plain', task.id);
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));

    // touch drag handlers
    enableTouchDrag(el, task);

    // actions
    el.addEventListener('click', (e) => {
      // If we just finished a drag via touch, suppress the synthetic click
      if (el._suppressNextClick) { el._suppressNextClick = false; return; }
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'delete') {
        if (confirm('Delete this task?')) send({ type: 'delete_task', taskId: task.id });
      } else if (action === 'edit') {
        const title = prompt('Title', task.title);
        if (title === null) return;
        const description = prompt('Description', task.description || '');
        const assignedTo = prompt('Assign to (optional username)', task.assignedTo || '');
        send({ type: 'edit_task', taskId: task.id, title, description, assignedTo: assignedTo || null });
      }
    });

    return el;
  }

  function renderTask(task, { replace = false } = {}) {
    const col = columns[task.status];
    if (!col) return;
    const existing = $(`.card[data-id="${task.id}"]`);
    const newEl = taskCardEl(task);
    if (existing && replace) {
      existing.replaceWith(newEl);
    } else if (!existing) {
      col.appendChild(newEl);
    }
  }

  function removeTask(taskId) {
    const existing = $(`.card[data-id="${taskId}"]`);
    if (existing) existing.remove();
  }

  function renderAllTasks(list) {
    Object.values(columns).forEach(col => col.innerHTML = '');
    list.forEach(renderTask);
  }

  function moveTask(taskId, to, highlight = false) {
    const card = $(`.card[data-id="${taskId}"]`);
    const col = columns[to];
    if (!card || !col) return;
    col.appendChild(card);
    if (highlight) {
      card.classList.add('highlight-move');
      setTimeout(() => card.classList.remove('highlight-move'), 900);
    }
  }

  // Drag/drop columns accept cards (desktop)
  $$('.column-body').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('dragover');
    });
    col.addEventListener('dragleave', () => col.classList.remove('dragover'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      const taskId = e.dataTransfer.getData('text/plain');
      const to = col.id.replace('col-', '');
      send({ type: 'move_task', taskId, to });
    });
  });

  // Improved touch drag-and-drop with thresholds and long-press
  function enableTouchDrag(cardEl, task) {
    let startX, startY, startTime, isPointerDown = false, isDragging = false, ghost, longPressTimer;

    const DRAG_DIST = 10; // px movement threshold
    const LONG_PRESS_MS = 180; // hold duration before drag can start

    const onTouchStart = (e) => {
      if (e.touches.length > 1) return; // ignore multi-touch
      isPointerDown = true; isDragging = false;
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY; startTime = Date.now();

      // set long-press to arm dragging; do not create ghost yet
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        if (!isPointerDown || isDragging) return;
        beginDrag(t.clientX, t.clientY);
      }, LONG_PRESS_MS);
    };

    const onTouchMove = (e) => {
      if (!isPointerDown) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dist = Math.hypot(dx, dy);

      // If moved far enough before long-press fired, start drag
      if (!isDragging && dist > DRAG_DIST && Date.now() - startTime >= LONG_PRESS_MS) {
        beginDrag(t.clientX, t.clientY);
      }

      if (!isDragging) return; // allow normal scroll/tap if not dragging

      moveGhost(t.clientX, t.clientY);
      const el = document.elementFromPoint(t.clientX, t.clientY);
      $$('.column-body').forEach(c => c.classList.toggle('dragover', c === el || c.contains(el)));
      e.preventDefault(); // prevent page scroll while dragging
    };

    const onTouchEnd = (e) => {
      clearTimeout(longPressTimer);
      if (!isPointerDown) return;

      // If we were dragging, drop; otherwise treat as tap (let click handler run)
      if (isDragging) {
        if (ghost) ghost.remove();
        cardEl.classList.remove('dragging');
        const t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
        const x = t ? t.clientX : startX, y = t ? t.clientY : startY;
        const el = document.elementFromPoint(x, y);
        const colBody = el && (el.closest && el.closest('.column-body')) || (el && el.classList && el.classList.contains('column-body') ? el : null);
        $$('.column-body').forEach(c => c.classList.remove('dragover'));
        if (colBody) {
          const to = colBody.id.replace('col-', '');
          send({ type: 'move_task', taskId: task.id, to });
        }
        // suppress the synthetic click following touchend after a drag
        cardEl._suppressNextClick = true;
      }

      isPointerDown = false; isDragging = false; ghost = null;
    };

    function beginDrag(x, y) {
      isDragging = true;
      ghost = cardEl.cloneNode(true);
      ghost.style.position = 'fixed';
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = '0.85';
      ghost.style.transform = 'scale(1.02)';
      ghost.style.transition = 'transform .08s ease';
      ghost.style.zIndex = '1000';
      ghost.style.width = cardEl.getBoundingClientRect().width + 'px';
      document.body.appendChild(ghost);
      cardEl.classList.add('dragging');
      moveGhost(x, y);
    }

    function moveGhost(x, y) {
      const offset = 14; // keep finger above ghost
      if (!ghost) return;
      ghost.style.left = (x - (ghost.offsetWidth / 2)) + 'px';
      ghost.style.top = (y - offset) + 'px';
    }

    cardEl.addEventListener('touchstart', onTouchStart, { passive: true });
    cardEl.addEventListener('touchmove', onTouchMove, { passive: false });
    cardEl.addEventListener('touchend', onTouchEnd, { passive: false });
    cardEl.addEventListener('touchcancel', onTouchEnd, { passive: false });
  }

  // New task form
  newTaskForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = taskTitle.value.trim();
    if (!title) return;
    send({ type: 'add_task', title, description: taskDesc.value, status: taskStatus.value });
    taskTitle.value = '';
    taskDesc.value = '';
    taskStatus.value = 'todo';
  });

  // Join button
  joinBtn.addEventListener('click', () => join());

  // Utils
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]|'/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Start
  connect();
})();

