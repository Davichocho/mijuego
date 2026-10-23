(() => {
  'use strict';
  const $ = id => document.getElementById(id), canvas = $('lane'), ctx = canvas.getContext('2d');
  const key = 'campo-skeeball-session-v1';
  let session = null, room = null, busy = false, polling = false, charging = false, chargeStart = 0, power = 0;
  let animation = null, resultUntil = 0, offset = 0, requestId = 0, applied = 0, nextPoll = 0;
  const targets = [[135,100,26,100],[465,100,26,100],[300,85,25,50],[300,145,27,40],[300,210,30,30],[300,280,34,20],[300,360,40,10]];
  const me = () => room?.players.find(p => p.id === room.youId);
  const ready = () => room?.status === 'playing' && me() && !me().left && me().shots.length < 9 && !busy && !animation;
  function error(message = '') { $('error').textContent = message; $('error').hidden = !message; }
  function remember() { try { session ? sessionStorage.setItem(key, JSON.stringify(session)) : sessionStorage.removeItem(key); } catch {} }
  function reset() {
    session = room = null; charging = false; animation = null; remember();
    $('entry').hidden = false; $('arena').hidden = true; $('shot-result').textContent = ''; busy = false;
  }
  async function api(path, body) {
    const id = ++requestId;
    const response = await fetch('api/skee/rooms' + path, {
      method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000)
    });
    const data = await response.json();
    if (!response.ok) {
      if ((response.status === 401 || response.status === 404) && session) reset();
      throw new Error(data.error || 'No se pudo completar la solicitud.');
    }
    if (data.youId && id >= applied && session) { applied = id; render(data); }
    return data;
  }
  function handleError(e) { error(e.name === 'TimeoutError' || e instanceof TypeError ? 'No hay conexión con el servidor. Reintentando…' : e.message); }
  async function action(fn) {
    if (busy) return;
    busy = true; error(); document.querySelectorAll('.entry-form button').forEach(b => b.disabled = true);
    try { await fn(); } catch (e) { handleError(e); }
    finally { busy = false; document.querySelectorAll('.entry-form button').forEach(b => b.disabled = false); if (room) render(room); }
  }
  function enter(data) {
    session = { code: data.code, token: data.token }; remember(); render(data.room);
    const url = new URL(location.href); url.searchParams.set('skee', data.code); history.replaceState(null, '', url);
    $('arena').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function render(data) {
    const oldRound = room?.round; room = data; offset = data.serverTime - Date.now();
    if (oldRound !== undefined && oldRound !== room.round) { animation = null; charging = false; $('shot-result').textContent = ''; power = 0; }
    $('entry').hidden = true; $('arena').hidden = false;
    $('room-code').textContent = room.code;
    const self = me(), host = room.hostId === room.youId, active = room.players.filter(p => !p.left);
    $('start').hidden = room.status !== 'lobby' || !host;
    $('start').disabled = active.length < 2 || busy;
    $('rematch').hidden = room.status !== 'finished' || !host; $('rematch').disabled = busy;
    $('score').textContent = String(self.score).padStart(3, '0');
    $('balls-count').textContent = (9 - self.shots.length) + ' BOLAS';
    const winners = room.players.filter(p => room.winnerIds.includes(p.id)).map(p => p.name);
    $('status').textContent = room.status === 'lobby'
      ? `${active.length}/${room.maxPlayers} jugadores en la sala. ${host ? 'Comparte el código y comienza cuando estén listos.' : 'Esperando a que el anfitrión inicie la partida.'}`
      : room.status === 'finished'
        ? `${room.endReason === 'time' ? '¡Tiempo terminado!' : '¡Ronda terminada!'} ${winners.length ? (winners.length > 1 ? 'Empate: ' : 'Ganador: ') + winners.join(' · ') + '.' : 'No hubo jugadores con lanzamientos válidos.'}`
        : self.shots.length === 9 ? '¡Completaste tus 9 bolas! Sigue el marcador mientras tus amigos terminan.' : '¡La pista es tuya! Todos juegan a su ritmo. Apunta y mantén el botón para cargar tu tiro.';
    $('ranking').replaceChildren();
    [...room.players].sort((a,b) => Number(a.left) - Number(b.left) || b.score - a.score).forEach((p,i) => {
      const li = document.createElement('li'); if (p.id === room.youId) li.className = 'me';
      const rank = document.createElement('span'); rank.className = 'place'; rank.textContent = room.winnerIds.includes(p.id) ? '★' : String(i+1).padStart(2,'0');
      const info = document.createElement('div'); info.className = 'player';
      const name = document.createElement('b'); name.textContent = p.name + (p.id === room.youId ? ' · Tú' : '');
      const sub = document.createElement('small'); sub.textContent = p.left ? 'Fuera de la partida' : `${p.shots.length}/9 bolas${p.connected ? '' : ' · Sin conexión'}${p.id === room.hostId ? ' · Anfitrión' : ''}`;
      info.append(name,sub); const points = document.createElement('strong'); points.className = 'points'; points.textContent = p.score; li.append(rank,info,points); $('ranking').append(li);
    });
    $('ball-tray').replaceChildren(); $('shots').replaceChildren();
    for(let i=0;i<9;i++) {
      const ball = document.createElement('span'); if (i<self.shots.length) ball.className = 'used'; $('ball-tray').append(ball);
      const chip = document.createElement('span'), label = document.createElement('small'); label.textContent = `BOLA ${i+1}`; chip.append(label,document.createTextNode(self.shots[i] ? String(self.shots[i].points) : '—')); $('shots').append(chip);
    }
    if (room.status !== 'playing') charging = false;
    updateControls(); clock();
  }
  function clock() {
    if (!room) return;
    let seconds = room.status === 'lobby' ? room.durationSeconds : room.endsAt ? Math.max(0, Math.ceil((room.endsAt - Date.now() - offset)/1000)) : 0;
    if (room.status === 'finished' && room.endReason === 'time') seconds = 0;
    if (room.status === 'finished') { $('clock').textContent = 'FINAL'; return; }
    $('clock').textContent = room.durationSeconds === 0 ? '∞' : `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  }
  $('create').addEventListener('submit', e => { e.preventDefault(); action(async () => {
    if (!$('name').reportValidity()) return;
    enter(await api('', { name: $('name').value.trim(), maxPlayers: +$('capacity').value, durationSeconds: +$('duration').value }));
  }); });
  $('join').addEventListener('submit', e => { e.preventDefault(); action(async () => {
    if (!$('name').reportValidity()) return;
    enter(await api('/' + encodeURIComponent($('code-input').value.trim().toUpperCase()) + '/join', { name: $('name').value.trim() }));
  }); });
  $('start').onclick = () => action(() => api('/' + session.code + '/start', { round: room.round }));
  $('rematch').onclick = () => action(() => api('/' + session.code + '/rematch', { round: room.round }));
  $('leave').onclick = () => action(async () => { await api('/' + session.code + '/leave', {}); reset(); const url = new URL(location.href); url.searchParams.delete('skee'); history.replaceState(null,'',url); });
  $('copy').onclick = async () => {
    const url = new URL(location.href); url.searchParams.set('skee', session.code);
    try { await navigator.clipboard.writeText(url.href); $('copy').textContent = '¡Enlace copiado!'; setTimeout(() => $('copy').textContent = 'Copiar invitación ↗',2500); }
    catch { error('Comparte el código ' + session.code + ' o copia la dirección de esta página.'); }
  };
  $('aim').oninput = () => { const aim = +$('aim').value; $('aim-value').textContent = aim === 0 ? 'Centro' : `${Math.abs(aim)}% ${aim < 0 ? 'izq.' : 'der.'}`; };
  function begin() { if (!ready() || charging) return; error(); charging = true; chargeStart = performance.now(); power = 0; }
  function cancel() { charging = false; power = 0; }
  function release() {
    if (!charging) return;
    charging = false;
    const cycle = ((performance.now() - chargeStart) % 2400) / 1200;
    power = cycle <= 1 ? cycle : 2 - cycle;
    const shotPower = power, shotAim = +$('aim').value / 100, number = me().shots.length + 1, round = room.round;
    action(async () => {
      const data = await api('/' + session.code + '/shot', { round, number, aim: shotAim, power: shotPower });
      const shot = data.players.find(p => p.id === data.youId).shots.find(s => s.number === number);
      if (shot) { animation = { shot, start: performance.now() }; $('shot-result').textContent = ''; }
    });
  }
  $('throw').addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); $('throw').focus(); $('throw').setPointerCapture(e.pointerId); begin(); });
  $('throw').addEventListener('pointerup', e => { e.preventDefault(); release(); });
  $('throw').addEventListener('pointercancel', cancel);
  $('throw').addEventListener('lostpointercapture', () => { if (charging) cancel(); });
  $('throw').addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) begin(); } });
  $('throw').addEventListener('keyup', e => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); release(); } });
  $('throw').addEventListener('blur', cancel); window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  function circle(x,y,r,fill,stroke,width=1) { ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke();} }
  function draw(time) {
    ctx.clearRect(0,0,600,900);
    const grad = ctx.createLinearGradient(0,0,0,900); grad.addColorStop(0,'#403149');grad.addColorStop(.48,'#463348');grad.addColorStop(.51,'#b07853');grad.addColorStop(1,'#dfb789');ctx.fillStyle=grad;ctx.fillRect(0,0,600,900);
    ctx.fillStyle='#241f30';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(42,0);ctx.lineTo(95,900);ctx.lineTo(0,900);ctx.fill();ctx.beginPath();ctx.moveTo(558,0);ctx.lineTo(600,0);ctx.lineTo(600,900);ctx.lineTo(505,900);ctx.fill();
    ctx.strokeStyle='#e6b281';ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(43,0);ctx.lineTo(96,900);ctx.moveTo(557,0);ctx.lineTo(504,900);ctx.stroke();
    ctx.strokeStyle='#895c4140';ctx.lineWidth=2;for(let i=0;i<8;i++){ctx.beginPath();ctx.moveTo(70+i*65,475);ctx.lineTo(100+i*56,900);ctx.stroke();}
    ctx.strokeStyle='#f3cda2';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(70,465);ctx.quadraticCurveTo(300,485,530,465);ctx.stroke();
    ctx.fillStyle='#513b3255';ctx.font='bold 18px sans-serif';ctx.textAlign='center';ctx.fillText('C A M P O   /   A R C A D E',300,690);
    for (const [x,y,r,points] of targets) {
      circle(x,y+5,r+9,'#171420');circle(x,y,r+8,'#725465',points===100?'#ffc475':'#d9bdd4',3);circle(x,y,r,'#191625',points===100?'#ffc475':'#c1abff',5);
      ctx.fillStyle=points===100?'#ffc475':'#fff4dc';ctx.font='bold '+(points===100?22:23)+'px monospace';ctx.fillText(points,x,y+8);
    }
    const aim = +$('aim').value/100;
    if (!animation) {
      ctx.setLineDash([9,12]);ctx.strokeStyle='#fff5db90';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(300,820);ctx.lineTo(300+aim*220,440);ctx.stroke();ctx.setLineDash([]);
      // A landing marker appears while charging, so the relationship between force and range is clear.
      if(charging){circle(300+aim*220,410-power*345,9,null,'#fff8df',2);}
    }
    let bx=300,by=835,r=21;
    if(animation){const t=Math.min(1,(time-animation.start)/1100),e=t*t*(3-2*t);bx=300+(animation.shot.x-300)*e;by=835+(animation.shot.y-835)*e-Math.sin(t*Math.PI)*110;r=21-8*t;
      if(t>=1){$('shot-result').textContent=animation.shot.points?`+${animation.shot.points} puntos`:'¡Casi! · 0 puntos';resultUntil=time+1500;animation=null;}}
    circle(bx+5,by+12,r,'#0003');const ball=ctx.createRadialGradient(bx-6,by-7,2,bx,by,r);ball.addColorStop(0,'#fff9df');ball.addColorStop(.6,'#efcea0');ball.addColorStop(1,'#a26c43');circle(bx,by,r,ball);
    if(resultUntil && time>resultUntil){$('shot-result').textContent='';resultUntil=0;}
  }
  function updateControls() {
    $('throw').disabled=!ready()&&!charging;$('throw').classList.toggle('charging',charging);
    $('throw').firstChild.textContent=charging?'Suelta para lanzar ':animation||busy?'Lanzando… ':me()?.shots.length===9?'Tus bolas están completas ':'Mantén para cargar ';
    $('aim').disabled=charging||busy||!!animation;
  }
  function frame(time) {
    if(charging){const cycle=((time-chargeStart)%2400)/1200;power=cycle<=1?cycle:2-cycle;}
    $('power-fill').style.width=(power*100)+'%';$('power-value').textContent=Math.round(power*100)+'%';$('power-meter').setAttribute('aria-valuenow',String(Math.round(power*100)));
    updateControls();
    if(!$('arena').hidden)draw(time);
    requestAnimationFrame(frame);
  }
  setInterval(async () => {
    clock(); if (!session || busy || polling || Date.now()<nextPoll) return;
    polling=true;
    try { await api('/'+session.code); if($('error').textContent.startsWith('No hay conexión'))error(); }
    catch(e){handleError(e);nextPoll=Date.now()+4000;}
    finally{polling=false;}
  },900);
  const invite=new URLSearchParams(location.search).get('skee');if(invite)$('code-input').value=invite.slice(0,6).toUpperCase();
  try { const saved=JSON.parse(sessionStorage.getItem(key));if(saved?.token&&saved?.code)session=saved; } catch {}
  if(session)action(async()=>{await api('/'+session.code);});
  requestAnimationFrame(frame);
})();
