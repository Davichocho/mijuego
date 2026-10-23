(() => {
  'use strict';
  const el = id => document.getElementById(id);
  el('online-color').value = el('custom-color').value;
  el('online-color').addEventListener('input', event => setTheme(event.target.value, 'Tu color'));
  const storageKey = 'campo-room-v1';
  const colors = ['#77964f','#9d78be','#d58659','#568fb3','#bc6c90','#b39c45','#58a18f','#92765b'];
  let session = null, state = null, timer = null, polling = false, generation = 0;
  let connected = false, busy = false, flagMode = false, boardRound = -1, cellButtons = [], timeOffset = 0;
  let expandedRound = -1;
  let rankingKey = '', connectionText = '', healthChecked = false, lastStatusAt = 0;
  function showError(message = '') { el('online-error').hidden = !message; el('online-error').textContent = message; }
  function connection(ok, text) {
    connected = ok;
    if (connectionText !== text) { el('connection-status').textContent = text; connectionText = text; }
    el('connection-status').classList.toggle('offline', !ok);
    if (state) updateControls();
  }
  function saveSession() {
    try { if (session) sessionStorage.setItem(storageKey, JSON.stringify(session)); else sessionStorage.removeItem(storageKey); } catch {}
  }
  async function request(path, body, credential = session) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const headers = { Accept: 'application/json' };
      if (credential) headers.Authorization = `Bearer ${credential.token}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(new URL(`api/${path}`, location.href), {
        method: body === undefined ? 'GET' : 'POST', headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal, cache: 'no-store', credentials: 'same-origin'
      });
      let data;
      try { data = await response.json(); } catch { throw new Error('No se encontró el servidor de partidas. Abre el sitio publicado en IIS o inicia el servidor ASP.NET Core.'); }
      if (!response.ok) { const error = new Error(data.error || 'No se pudo completar la solicitud.'); error.status = response.status; throw error; }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('No hay conexión con el servidor. Volveremos a intentar automáticamente.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function selectTab(online) {
    if (!online) setExpanded(false);
    el('online-section').hidden = !online; el('play').hidden = online;
    el('online-tab').classList.toggle('selected', online); el('online-tab').setAttribute('aria-pressed', String(online));
    el('local-tab').classList.toggle('selected', !online); el('local-tab').setAttribute('aria-pressed', String(!online));
    if (online && !session && !healthChecked) {
      healthChecked = true;
      request('health', undefined, null).then(data => {
        if (data.service !== 'Campo' || data.protocol !== 3) throw new Error('El servidor de partidas no está disponible en esta dirección.');
      }).catch(error => { healthChecked = false; if (!session) showError(error.message); });
    }
  }
  el('online-tab').addEventListener('click', () => selectTab(true));
  el('local-tab').addEventListener('click', () => selectTab(false));
  el('room-mode').addEventListener('change', () => {
    const duel = el('room-mode').value === 'duel'; el('room-size').disabled = duel; el('room-size').value = duel ? '2' : '4';
  });
  function playerName() {
    const name = el('online-name').value.trim();
    if (!name || name.length > 18) { el('online-name').focus(); throw new Error('Escribe tu nombre para entrar a la partida (máximo 18 caracteres).'); }
    return name;
  }
  function entryBusy(value) {
    el('create-room-form').querySelector('button[type=submit]').disabled = value;
    el('join-room-form').querySelector('button[type=submit]').disabled = value;
  }
  async function enter(create) {
    if (busy) return;
    busy = true; entryBusy(true); showError();
    try {
      const name = playerName();
      const code = el('join-code').value.trim().toUpperCase();
      if (!create && !/^[A-Z2-9]{6}$/.test(code)) throw new Error('El código debe tener seis letras o números.');
      const data = await request(create ? 'rooms' : `rooms/${code}/join`, create ? {
        name, mode: el('room-mode').value, maxPlayers: Number(el('room-size').value), durationSeconds: Number(el('room-duration').value)
      } : { name }, null);
      generation++; session = { code: data.code, token: data.token }; saveSession();
      state = null; boardRound = -1; rankingKey = ''; el('online-entry').hidden = true; el('room-view').hidden = false;
      showError(); connection(true, '● Conectado · actualizando en vivo'); render(data.room); schedulePoll();
    } catch (error) { showError(error.message); }
    finally { busy = false; entryBusy(false); if (state) updateControls(); }
  }
  el('create-room-form').addEventListener('submit', event => { event.preventDefault(); enter(true); });
  el('join-room-form').addEventListener('submit', event => { event.preventDefault(); enter(false); });
  function schedulePoll(delay = 900) { clearTimeout(timer); if (session) timer = setTimeout(poll, delay); }
  async function poll() {
    if (!session || polling) return;
    polling = true; const epoch = generation; const current = session;
    try {
      const data = await request(`rooms/${current.code}`, undefined, current);
      if (epoch !== generation) return;
      connection(true, '● Conectado · actualizando en vivo'); render(data);
    } catch (error) {
      if (epoch !== generation) return;
      if (error.status === 401 || error.status === 404) { resetSession(); showError(error.message); }
      else connection(false, '○ Reconectando… La partida sigue en curso.');
    } finally { polling = false; if (session) schedulePoll(connected ? 900 : 2500); }
  }
  function resetSession() {RoomChat.detach();
    setExpanded(false); expandedRound = -1;
    generation++; session = null; state = null; connected = false; saveSession(); clearTimeout(timer);
    el('room-view').hidden = true; el('online-entry').hidden = false; boardRound = -1; rankingKey = ''; busy = false;
    el('online-board').replaceChildren(); cellButtons = [];
  }
  async function action(kind, extra = {}) {
    if (!session || !state || busy || !connected) return;
    busy = true; updateControls(); showError(); const epoch = generation;
    try {
      const data = await request(`rooms/${session.code}/${kind}`, { round: state.round, ...extra });
      if (epoch === generation) { connection(true, '● Conectado · actualizando en vivo'); render(data); }
    } catch (error) {
      if (epoch === generation) {
        if (error.status === 401 || error.status === 404) resetSession();
        else if (!error.status) connection(false, '○ Reconectando… Verifica tu conexión.');
        showError(error.message); schedulePoll(100);
      }
    } finally { busy = false; if (state) updateControls(); }
  }
  el('start-room').addEventListener('click', () => action('start'));
  el('rematch-room').addEventListener('click', () => action('rematch'));
  el('leave-room').addEventListener('click', async () => {
    if (!session || busy) return;
    if (state?.status === 'playing' && !confirm('Salir te elimina de esta ronda. ¿Quieres salir de la sala?')) return;
    const old = session; busy = true; if (state) updateControls();
    let message = '';
    try { await request(`rooms/${old.code}/leave`, {}); }
    catch { message = 'Saliste de esta pestaña. Si no llegó el aviso al servidor, tu lugar se liberará tras 120 segundos sin conexión.'; }
    resetSession(); showError(message);
    const url = new URL(location.href); url.searchParams.delete('sala'); history.replaceState(null, '', url);
  });
  el('copy-room').addEventListener('click', async () => {
    if (!session) return;
    const url = new URL(location.href); url.search = ''; url.searchParams.set('sala', session.code); url.hash = 'game-zone';
    try {
      await navigator.clipboard.writeText(url.toString()); el('copy-room').textContent = '¡Invitación copiada!';
      setTimeout(() => { el('copy-room').textContent = 'Copiar invitación'; }, 2200);
    } catch { showError(`Comparte esta dirección y el código ${session.code}: ${url.toString()}`); }
  });
  function canMark() { return connected && state?.status === 'playing' && state.players.some(p => p.id === state.youId && p.alive && !p.left); }
  function canPlay() { return canMark(); }
  function chooseCell(index, flag = flagMode) { if ((flag ? canMark() : canPlay()) && !busy) action(flag ? 'flag' : 'reveal', { index }); }
  function buildBoard() {
    const board = el('online-board'); board.replaceChildren(); cellButtons = [];
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < state.rows * state.cols; i++) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'cell'; button.tabIndex = i === state.players.find(p => p.id === state.youId)?.startIndex ? 0 : -1;
      button.addEventListener('focus', () => { cellButtons.forEach(b => { b.tabIndex = b === button ? 0 : -1; }); });
      button.addEventListener('click', () => chooseCell(i));
      button.addEventListener('contextmenu', event => { event.preventDefault(); chooseCell(i, true); });
      button.addEventListener('keydown', event => {
        const offsets = { ArrowUp: -state.cols, ArrowDown: state.cols, ArrowLeft: -1, ArrowRight: 1 };
        if (!(event.key in offsets)) return;
        event.preventDefault(); const next = i + offsets[event.key];
        if (next >= 0 && next < cellButtons.length) { cellButtons[next].focus({ preventScroll: true }); cellButtons[next].scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      });
      cellButtons.push(button); fragment.append(button);
    }
    board.append(fragment); board.style.setProperty('--cols', state.cols); boardRound = state.round;
    flagMode = false; el('online-flag').setAttribute('aria-pressed', 'false');
    fitBoard();
  }
  function fitBoard() {
    if (!state || !cellButtons.length || el('online-board-area').hidden) return;
    const box = el('online-board-scroll');
    const width = box.clientWidth, height = box.clientHeight;
    if (!width || !height) return;
    const gap = width / state.cols < 14 ? 0.5 : 2;
    const size = Math.max(1, Math.floor(Math.min((width - gap * (state.cols - 1)) / state.cols,
      (height - gap * (state.rows - 1)) / state.rows) * 100) / 100);
    el('online-board').style.setProperty('--cell', `${size}px`);
    el('online-board').style.setProperty('--board-gap', `${gap}px`);
  }
  function setExpanded(expanded) {
    el('room-view').classList.toggle('field-expanded', expanded);
    document.body.classList.toggle('field-focused', expanded);
    el('expand-field').setAttribute('aria-pressed', String(expanded));
    el('expand-field').textContent = expanded ? '↙ Volver a la página' : '⛶ Ampliar mapa';
    fitBoard();
  }
  function centerField() {
    const you = state?.players.find(p => p.id === state.youId);
    cellButtons[you?.startIndex]?.focus({ preventScroll: true });
  }
  el('center-field').addEventListener('click', centerField);
  el('expand-field').addEventListener('click', () => setExpanded(!el('room-view').classList.contains('field-expanded')));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setExpanded(false);
  });
  new ResizeObserver(fitBoard).observe(el('online-board-scroll'));
  window.addEventListener('resize', fitBoard);
  window.visualViewport?.addEventListener('resize', fitBoard);
  el('online-flag').addEventListener('click', () => { flagMode = !flagMode; el('online-flag').setAttribute('aria-pressed', String(flagMode)); if (state) render(state); });
  function render(data) {
    if(session)RoomChat.attach({base:'api/rooms',...session});
    if (state && data.version < state.version) return;
    state = data; timeOffset = data.serverTime - Date.now(); lastStatusAt = Date.now();
    el('room-code').textContent = data.code;
    el('room-count').textContent = `${data.players.filter(p => !p.left).length} / ${data.maxPlayers}`;
    el('room-summary').textContent = `${data.mode === 'duel' ? 'Duelo 1 vs 1' : 'Todos contra todos'} · 40 × 24 · ${data.durationSeconds ? `${data.durationSeconds / 60} min` : 'sin límite'}`;
    const lobby = data.status === 'lobby', ended = data.status === 'finished';
    el('expand-field').hidden = lobby;
    if (lobby) { setExpanded(false); expandedRound = -1; }
    else if (expandedRound !== data.round) { expandedRound = data.round; setExpanded(true); }
    el('lobby-placeholder').hidden = !lobby; el('online-board-area').hidden = lobby;
    el('arena-phase').textContent = lobby ? 'SALA DE ESPERA' : ended ? 'RESULTADO DE LA RONDA' : 'TODOS JUEGAN A SU RITMO';
    el('arena-title').textContent = lobby ? 'Todo listo para explorar' : ended ? 'Cada casilla cuenta.' : 'Explora con la misma oportunidad.';
    el('safe-count').textContent = lobby ? '180 minas' : `${data.remainingSafe} casillas seguras pendientes`;
    const you = data.players.find(p => p.id === data.youId);
    const hostName = data.players.find(p => p.id === data.hostId)?.name || 'el anfitrión';
    let message = lobby ? (data.youId === data.hostId ? 'Invita a tus amigos. Puedes comenzar cuando haya al menos dos jugadores.' : `Esperando a que ${hostName} comience la partida…`) :
      !you?.alive ? 'Una mina: −20 puntos y fuera del campo. Tu puntuación final todavía compite.' :
      !you.hasOpened ? 'Pulsa la estrella para abrir tu zona segura. Puedes empezar ya, sin esperar a nadie.' :
      'Juega a tu ritmo. Cada jugada segura suma 10 puntos y las casillas vacías despejan una zona completa.';
    if (ended) message = 'La ronda terminó. El anfitrión puede preparar una revancha con este mismo código.';
    if (el('room-message').textContent !== message) el('room-message').textContent = message;
    renderPlayers(); renderResult();
    if (!lobby) {
      if (boardRound !== data.round) buildBoard();
      const visible = new Map(data.cells.map(c => [c.index, c])); const flags = new Set(data.flags);
      cellButtons.forEach((button, index) => {
        const cell = visible.get(index); const flagged = flags.has(index);
        const owner = cell?.ownerId ? data.players.find(p => p.id === cell.ownerId) : null;
        const startOwner = data.players.find(p => p.alive && !p.left && !p.hasOpened && p.startIndex === index);
        const signature = `${startOwner?.id || ''}|${cell?.number ?? ''}|${cell?.mine ?? ''}|${cell?.ownerId ?? ''}|${flagged}`;
        if (button.dataset.view !== signature) {
          button.dataset.view = signature; button.className = 'cell'; delete button.dataset.number; button.textContent = '';
          let description = 'sin descubrir';
          if (cell) {
            button.classList.add('revealed');
            if (cell.mine) { button.classList.add('mine'); if (cell.ownerId) button.classList.add('exploded'); button.textContent = '✳'; description = 'mina'; }
            else { button.textContent = cell.number || ''; button.dataset.number = cell.number; description = cell.number ? `${cell.number} minas alrededor` : 'vacía'; }
            if (owner) { button.classList.add('claimed'); button.style.setProperty('--owner-color', colors[data.players.indexOf(owner) % colors.length]); description += `, descubierta por ${owner.name}`; }
          } else if (startOwner) {
            const mine = startOwner.id === data.youId; button.classList.add(mine ? 'safe-start' : 'reserved-start');
            button.textContent = mine ? '✦' : '◇'; description = mine ? 'tu salida segura, abre aquí tu zona inicial' : `salida reservada de ${startOwner.name}`;
          } else if (flagged) { button.classList.add('flagged'); button.textContent = '⚑'; description = 'tu bandera'; }
          button.setAttribute('aria-label', `Fila ${Math.floor(index / data.cols) + 1}, columna ${index % data.cols + 1}: ${description}`);
        }
        button.setAttribute('aria-disabled', String(!(flagMode ? canMark() : canPlay()) || !!cell));
      });
    }
    updateControls(); updateClock(); fitBoard();
  }
  function renderPlayers() {
    const key = JSON.stringify([state.status, state.players, state.hostId, state.winnerIds]);
    if (key === rankingKey) return;
    rankingKey = key; const list = el('room-players'); list.replaceChildren();
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    sorted.forEach(player => {
      const item = document.createElement('li'); item.className = `room-player${player.id === state.youId ? ' you' : ''}${!player.alive || player.left ? ' out' : ''}`;
      const avatar = document.createElement('span'); avatar.className = 'player-avatar'; avatar.textContent = player.name.slice(0, 2).toUpperCase(); avatar.style.color = colors[state.players.indexOf(player) % colors.length];
      const detail = document.createElement('div'); detail.className = 'player-detail';
      const name = document.createElement('strong'); name.textContent = player.name + (player.id === state.youId ? ' (tú)' : '');
      const label = document.createElement('small');
      label.textContent = state.winnerIds.includes(player.id) ? '✦ Ganador' : player.left ? (player.reason === 'disconnected' ? 'Sin conexión · fuera' : 'Abandonó') : !player.alive ? 'Mina · −20 pts · fuera' : !player.connected ? 'Reconectando…' : state.status === 'lobby' ? 'Listo para jugar' : !player.hasOpened ? 'Primera apertura pendiente' : 'En el campo';
      if (player.id === state.hostId) label.textContent += ' · anfitrión'; detail.append(name, label);
      const points = document.createElement('span'); points.className = 'player-points'; points.textContent = player.score;
      const unit = document.createElement('small'); unit.textContent = 'pts'; points.append(unit);
      item.append(avatar, detail, points); list.append(item);
    });
  }
  function renderResult() {
    const result = el('room-result'); result.hidden = state.status !== 'finished'; if (result.hidden) return;
    const winners = state.players.filter(p => state.winnerIds.includes(p.id));
    const heading = winners.length === 0 ? 'Sin jugadores clasificados' : winners.length > 1 ? `Empate: ${winners.map(p => p.name).join(' y ')}` : `¡${winners[0].name} gana!`;
    const reasons = { time: 'Se agotó el tiempo.', cleared: 'Se despejaron todas las casillas seguras.', survivor: 'No quedan más rivales en el campo.' };
    const description = `${reasons[state.endReason] || ''} ${winners.length ? `${winners[0].score} puntos. Mayor puntuación final, incluidas las penalizaciones.` : 'Nadie se lleva la victoria esta vez.'}`;
    if (result.dataset.result === heading + description) return;
    result.dataset.result = heading + description; result.replaceChildren();
    const title = document.createElement('h3'); title.textContent = heading; const text = document.createElement('p'); text.textContent = description; result.append(title, text);
  }
  function updateControls() {
    if (!state) return;
    const host = state.hostId === state.youId;
    el('start-room').hidden = !host || state.status !== 'lobby'; el('start-room').disabled = busy || !connected || state.players.filter(p => !p.left).length < 2;
    el('rematch-room').hidden = !host || state.status !== 'finished'; el('rematch-room').disabled = busy || !connected;
    el('leave-room').disabled = busy; el('online-flag').disabled = !canMark();
  }
  function formatTime(milliseconds) { const seconds = Math.max(0, Math.ceil(milliseconds / 1000)); return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
  function updateClock() {
    if (!state) return;
    const now = state.finishedAt || Date.now() + timeOffset;
    el('room-clock-label').textContent = state.durationSeconds ? 'TIEMPO RESTANTE' : 'TIEMPO TRANSCURRIDO';
    el('room-timer').textContent = state.status === 'lobby' ? state.durationSeconds ? formatTime(state.durationSeconds * 1000) : 'Sin límite' :
      state.endsAt ? formatTime(state.endsAt - now) : formatTime(now - state.startedAt);
    el('room-timer').parentElement.classList.toggle('urgent', state.status === 'playing' && state.endsAt && state.endsAt - now <= 30000);
    if (connected && Date.now() - lastStatusAt > 10000) connection(false, '○ Esperando al servidor…');
  }
  setInterval(updateClock, 500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && session) schedulePoll(0); });
  window.addEventListener('online', () => { if (session) schedulePoll(0); });
  const rules = el('online-rules');
  el('online-rules-open').addEventListener('click', () => rules.showModal());
  ['online-rules-close', 'online-rules-ready'].forEach(id => el(id).addEventListener('click', () => rules.close()));
  async function restore() {
    const invitation = new URL(location.href).searchParams.get('sala');
    if (invitation && /^[a-z2-9]{6}$/i.test(invitation)) { el('join-code').value = invitation.toUpperCase(); selectTab(true); }
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
    if (!saved || !/^[A-Z2-9]{6}$/.test(saved.code) || !/^[A-F0-9]{64}$/.test(saved.token)) return;
    // Recuperar primero la sala propia evita perder una sesión viva al abrir otra invitación.
    session = saved; selectTab(true); el('online-entry').hidden = true; el('room-view').hidden = false;
    el('room-code').textContent = saved.code; el('room-message').textContent = 'Recuperando tu lugar en la sala…';
    connection(false, '○ Recuperando la conexión…'); schedulePoll(0);
  }
  restore();
})();
