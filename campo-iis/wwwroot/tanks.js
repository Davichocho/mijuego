(() => {
  'use strict';
  const $=id=>document.getElementById(id), canvas=$('battle'), ctx=canvas.getContext('2d');
  const terrain=document.createElement('canvas'); terrain.width=840; terrain.height=600;
  const floor=terrain.getContext('2d'), keys=new Set(), storage='campo-tanks-v1';
  const colors=['#b5f4cb','#ffc18c','#9bc9ff','#efaaff','#f7e786','#83e3df','#ff9caf','#c6b6ff'];
  const controls=['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let session=null,room=null,previous=null,received=0,busy=false,pending=false,sequence=Date.now(),offset=0;
  let timer=null,lastRequest=0,latency=0,visual=null,lastFrame=0,eventCursor=0,feed=[],particles=[],ripples=[],damageUntil=0,hitUntil=0;
  let mapKey='',fireTap=false,sound=false,audio=null,expanded=false,rankKey='',flash=new Map(),bodyAngles=new Map();
  const serverNow=()=>Date.now()+offset;
  const self=()=>room?.players.find(p=>p.id===room.youId);
  let aimLatch={x:1,y:0};
  const input=()=>{const ax=Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),ay=Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'));if(ax||ay)aimLatch={x:ax,y:ay};return {x:Number(keys.has('KeyD'))-Number(keys.has('KeyA')),y:Number(keys.has('KeyS'))-Number(keys.has('KeyW')),aimX:aimLatch.x,aimY:aimLatch.y};};
  function error(message=''){$('error').textContent=message;$('error').hidden=!message;}
  function save(){try{session?sessionStorage.setItem(storage,JSON.stringify(session)):sessionStorage.removeItem(storage);}catch{}}
  function clearKeys(){keys.clear();fireTap=false;document.querySelectorAll('[data-key]').forEach(b=>b.classList.remove('active'));}
  function expand(value){expanded=value;document.body.classList.toggle('arena-expanded',value);$('expand').textContent=value?'↙ Reducir':'⛶ Ampliar';$('expand').setAttribute('aria-pressed',String(value));resize();}
  function reset(){session=room=previous=null;visual=null;clearKeys();save();expand(false);$('entry').hidden=false;$('arena').hidden=true;}
  function report(e){error(e.name==='TimeoutError'||e instanceof TypeError?'Conexión interrumpida. Tu tanque se detiene; reintentando…':e.message);clearKeys();$('connection').textContent='Reconectando…';$('connection').classList.add('slow');}
  async function api(path,body){
    const r=await fetch('api/tanks/rooms'+path,{method:body===undefined?'GET':'POST',cache:'no-store',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(6000)});
    const data=await r.json();if(!r.ok){if(r.status===401||r.status===404)reset();throw new Error(data.error||'No se pudo completar la solicitud.');}return data;
  }
  async function action(fn){if(busy)return;busy=true;clearKeys();error();document.querySelectorAll('form button,#start,#rematch,#overlay-rematch').forEach(b=>b.disabled=true);
    try{while(pending)await new Promise(r=>setTimeout(r,20));await fn();}catch(e){report(e);}finally{busy=false;document.querySelectorAll('form button,#rematch,#overlay-rematch').forEach(b=>b.disabled=false);if(room)updateHud();wake();}}
  function tone(kind,own=true){
    if(!sound)return;try{audio??=new (window.AudioContext||window.webkitAudioContext)();if(audio.state!=='running')return;
      const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime; o.type=kind==='destroy'?'sawtooth':'triangle';
      o.frequency.setValueAtTime(kind==='shot'?180:kind==='hit'?440:100,t);o.frequency.exponentialRampToValueAtTime(kind==='hit'?220:35,t+.13);
      g.gain.setValueAtTime(own?.035:.012,t);g.gain.exponentialRampToValueAtTime(.001,t+.16);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.17);
    }catch{sound=false;$('sound').textContent='Sonido: no';$('sound').setAttribute('aria-pressed','false');}}
  function burst(x,y,color,count=12){if(reduced)return;for(let i=0;i<count;i++){const angle=Math.random()*Math.PI*2,speed=30+Math.random()*110;particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,color,life:.3+Math.random()*.4,max:.7,size:1+Math.random()*3});}if(particles.length>250)particles.splice(0,particles.length-250);}
  function events(data,fresh){
    let feedChanged=fresh;
    if(fresh){eventCursor=0;feed=[];particles=[];ripples=[];flash.clear();}
    for(const e of data.events||[]){if(e.id<=eventCursor)continue;eventCursor=e.id;if(data.serverTime-e.at>1000)continue;
      const mine=e.actor===data.youId,now=performance.now();
      if(e.kind==='shot'){flash.set(e.actor,now+100);tone('shot',mine);}
      else if(e.kind==='wall')burst(e.x,e.y,'#f6cd8a',5);
      else if(e.kind==='spawn'){ripples.push({x:e.x,y:e.y,until:now+650,color:'#a6e8e5'});}
      else if(e.kind==='hit'||e.kind==='destroy'){
        burst(e.x,e.y,e.kind==='hit'?'#ffd995':'#ffa879',e.kind==='destroy'?30:12);tone(e.kind,mine||e.target===data.youId);
        if(mine)hitUntil=now+180;if(e.target===data.youId)damageUntil=now+260;
        if(e.kind==='destroy'){ripples.push({x:e.x,y:e.y,until:now+650,color:'#ffb37e'});feed.unshift({actor:e.actor,target:e.target});feed=feed.slice(0,4);feedChanged=true;}
      }
    }
    if(!feedChanged)return;
    $('feed').replaceChildren();if(!feed.length){const li=document.createElement('li');li.textContent='El frente está en silencio.';$('feed').append(li);}
    for(const e of feed){const li=document.createElement('li'),a=document.createElement('b'),b=document.createElement('b'),sep=document.createElement('span');a.textContent=data.players.find(p=>p.id===e.actor)?.name||'Piloto';b.textContent=data.players.find(p=>p.id===e.target)?.name||'Piloto';sep.textContent='›';li.append(a,sep,b);$('feed').append(li);}
  }
  function render(data){
    const fresh=!room||room.round!==data.round||room.status==='lobby'&&data.status==='playing';previous=fresh?null:room;room=data;received=performance.now();offset=data.serverTime-Date.now()+latency/2;
    $('entry').hidden=true;$('arena').hidden=false;$('room-code').textContent=room.code;$('round').textContent=String(room.round+1).padStart(2,'0');
    const key=room.map.join('');if(key!==mapKey){mapKey=key;paintTerrain();}
    if(fresh){visual=null;bodyAngles.clear();rankKey='';aimLatch={x:Math.round(Math.cos(self().aim)),y:Math.round(Math.sin(self().aim))};}
    if(room.status==='playing'&&(!previous||previous.status!=='playing')){expand(true);canvas.focus({preventScroll:true});}
    if(room.status!=='playing')clearKeys();
    events(data,fresh);updateHud();resize();
  }
  function updateHud(){
    if(!room)return;const p=self(),host=room.hostId===room.youId,active=room.players.filter(p=>!p.left);
    $('start').hidden=room.status!=='lobby'||!host;$('start').disabled=busy||active.length<2;
    $('rematch').hidden=room.status!=='finished'||!host;$('overlay-rematch').hidden=room.status!=='finished'||!host;
    $('player-count').textContent=`${active.length}/${room.maxPlayers}`;
    $('status').textContent=room.status==='lobby'?`${active.length}/${room.maxPlayers} pilotos listos. ${host?'Invita a tus amigos y comienza el combate.':'Esperando al anfitrión.'}`:room.status==='finished'?'Combate terminado. Prepara tu próxima revancha.':p.hp===0?'Blindaje destruido. Preparando tu regreso…':'Muévete con WASD · Apunta con las flechas · Dispara con Espacio';
    $('health').textContent=p.hp===0?'REAPARECIENDO':'BLINDAJE '+ '● '.repeat(p.hp)+'○ '.repeat(3-p.hp);
    const signature=JSON.stringify(room.players.map(q=>[q.id,q.name,q.score,q.hp,q.left,q.deaths]))+room.winnerIds.join();if(signature===rankKey)return;rankKey=signature;
    $('ranking').replaceChildren();[...room.players].sort((a,b)=>Number(a.left)-Number(b.left)||b.score-a.score).forEach(p=>{
      const li=document.createElement('li'),dot=document.createElement('span'),info=document.createElement('div'),name=document.createElement('b'),sub=document.createElement('small'),score=document.createElement('strong'),bar=document.createElement('span'),fill=document.createElement('i');
      if(p.id===room.youId)li.className='me';dot.className='rank-dot';dot.style.background=colors[room.players.findIndex(q=>q.id===p.id)%8];info.className='player';name.textContent=p.name+(p.id===room.youId?' · Tú':'');sub.textContent=p.left?'Fuera':`${p.hp}/3 blindaje · ${p.deaths} caídas${room.winnerIds.includes(p.id)?' · ★':''}`;
      bar.className='score-progress';fill.style.width=(p.score/5*100)+'%';bar.append(fill);score.className='points';score.textContent=p.score;info.append(name,sub,bar);li.append(dot,info,score);$('ranking').append(li);
    });
  }
  function enter(data){session={code:data.code,token:data.token};save();const url=new URL(location.href);url.searchParams.set('tanques',session.code);history.replaceState(null,'',url);render(data.room);$('arena').scrollIntoView({block:'start',behavior:'smooth'});}
  $('create').onsubmit=e=>{e.preventDefault();action(async()=>{if($('name').reportValidity())enter(await api('',{name:$('name').value,maxPlayers:+$('capacity').value}));});};
  $('join').onsubmit=e=>{e.preventDefault();action(async()=>{if($('name').reportValidity())enter(await api('/'+encodeURIComponent($('code').value.toUpperCase())+'/join',{name:$('name').value}));});};
  $('start').onclick=()=>action(async()=>render(await api('/'+session.code+'/start',{round:room.round})));
  $('rematch').onclick=$('overlay-rematch').onclick=()=>action(async()=>render(await api('/'+session.code+'/rematch',{round:room.round})));
  $('leave').onclick=()=>action(async()=>{await api('/'+session.code+'/leave',{});reset();history.replaceState(null,'',location.pathname);});
  $('expand').onclick=()=>{expand(!expanded);canvas.focus({preventScroll:true});};
  $('sound').onclick=async()=>{sound=!sound;try{if(sound){audio??=new (window.AudioContext||window.webkitAudioContext)();await audio.resume();}}catch{sound=false;}$('sound').textContent=sound?'Sonido: sí':'Sonido: no';$('sound').setAttribute('aria-pressed',String(sound));canvas.focus({preventScroll:true});};
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);$('copy').textContent='¡Copiado!';setTimeout(()=>$('copy').textContent='Invitar ↗',2000);}catch{error('Comparte el código '+session.code+' o copia la dirección de esta página.');}};
  function press(key,on){if(on){if(key==='Space'&&!keys.has(key)&&serverNow()>=room.startsAt)fireTap=true;keys.add(key);}else keys.delete(key);input();wake();}
  window.addEventListener('keydown',e=>{if(e.code==='Escape'&&expanded){clearKeys();expand(false);wake();return;}if(room?.status!=='playing'||!controls.includes(e.code)||(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||(e.target.tagName==='BUTTON'&&e.code==='Space')))return;e.preventDefault();canvas.focus({preventScroll:true});if(!e.repeat)press(e.code,true);});
  window.addEventListener('keyup',e=>{if(keys.has(e.code)){e.preventDefault();press(e.code,false);}});
  window.addEventListener('blur',()=>{clearKeys();wake();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearKeys();wake();}});
  canvas.addEventListener('pointerdown',()=>canvas.focus({preventScroll:true}));
  document.querySelectorAll('[data-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);if(room?.status==='playing'){press(b.dataset.key,true);b.classList.add('active');}};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>{press(b.dataset.key,false);b.classList.remove('active');};});
  function wake(){if(pending||busy)return;clearTimeout(timer);timer=setTimeout(poll,Math.max(0,50-(performance.now()-lastRequest)));}
  async function poll(){
    if(!session||busy||pending){timer=setTimeout(poll,250);return;}
    pending=true;lastRequest=performance.now();let delay=room?.status==='playing'?75:500;
    try{const path='/'+session.code,playing=room?.status==='playing';let body;
      if(playing){body={round:room.round,sequence:++sequence,...input(),fire:keys.has('Space')||fireTap};fireTap=false;}
      const data=await api(path+(playing?'/input':''),body);latency=performance.now()-lastRequest;$('connection').textContent=`● ${Math.round(latency)} ms`;$('connection').classList.toggle('slow',latency>200);render(data);if($('error').textContent.startsWith('Conexión'))error();
    }catch(e){report(e);delay=1500;}finally{pending=false;clearTimeout(timer);timer=setTimeout(poll,delay);}
  }
  function resize(){if($('arena').hidden)return;const rect=$('stage').getBoundingClientRect(),width=Math.max(0,Math.min(rect.width,rect.height*1.4));canvas.style.width=width+'px';canvas.style.height=width/1.4+'px';}
  new ResizeObserver(resize).observe($('stage'));
  function paintTerrain(){
    floor.fillStyle='#182b32';floor.fillRect(0,0,840,600);
    for(let y=0;y<15;y++)for(let x=0;x<21;x++){
      const px=x*40,py=y*40;
      if(room.map[y][x]==='#'){
        floor.fillStyle='#08131b80';floor.fillRect(px+4,py+7,39,39);floor.fillStyle='#304c58';floor.fillRect(px+1,py+1,38,37);floor.fillStyle='#496672';floor.fillRect(px+1,py+1,38,5);floor.fillStyle='#223b46';floor.fillRect(px+1,py+33,38,6);floor.strokeStyle='#5c778044';floor.strokeRect(px+5,py+8,29,20);
        floor.fillStyle='#748d9344';floor.fillRect(px+7,py+10,2,2);floor.fillRect(px+31,py+25,2,2);
      }else{
        floor.fillStyle=(x+y)%2?'#172a32':'#192d35';floor.fillRect(px,py,40,40);floor.strokeStyle='#3d596030';floor.strokeRect(px+.5,py+.5,39,39);floor.fillStyle='#81948918';floor.fillRect(px+19,py+19,2,2);
      }
    }
    floor.strokeStyle='#b8d8b828';floor.lineWidth=1;floor.setLineDash([4,7]);floor.strokeRect(324,204,192,192);floor.setLineDash([]);floor.beginPath();floor.arc(420,300,48,0,Math.PI*2);floor.stroke();floor.beginPath();floor.moveTo(408,300);floor.lineTo(432,300);floor.moveTo(420,288);floor.lineTo(420,312);floor.stroke();
    floor.fillStyle='#afc6c43b';floor.font='9px monospace';floor.textAlign='center';floor.fillText('Z O N A  C E N T R A L',420,376);
  }
  function circle(x,y,r,fill,stroke){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}}
  function tank(p,x,y,angle,index,time){
    const mine=p.id===room.youId,color=colors[index%8],old=previous?.players.find(q=>q.id===p.id),moving=old&&Math.hypot(old.x-p.x,old.y-p.y)>1;
    let heading=bodyAngles.get(p.id)??-Math.PI/2;if(moving)heading=Math.atan2(p.y-old.y,p.x-old.x);if(mine){const a=input();if(a.x||a.y)heading=Math.atan2(a.y,a.x);}bodyAngles.set(p.id,heading);
    ctx.save();ctx.translate(x,y);circle(2,4,15,'#0005');
    if(p.shieldUntil>serverNow()){ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.lineDashOffset=-time/70;circle(0,0,19,null,'#9ce0f4');ctx.setLineDash([]);circle(0,0,17,'#a7ecff10');}
    if(mine){ctx.lineWidth=1;circle(0,0,16,null,'#f6ffdcaa');}
    ctx.save();ctx.rotate(heading);
    ctx.fillStyle='#0b161e';ctx.fillRect(-12,-14,25,7);ctx.fillRect(-12,7,25,7);
    ctx.fillStyle='#536b72';for(let i=0;i<5;i++){const n=-10+i*5+(moving?Math.floor(time/70)%3:0);ctx.fillRect(n,-13,2,5);ctx.fillRect(n,8,2,5);}
    ctx.fillStyle=color;ctx.fillRect(-11,-8,22,16);ctx.fillStyle='#0003';ctx.fillRect(-9,-6,5,12);ctx.fillStyle='#fff5';ctx.fillRect(-9,-8,18,2);ctx.restore();
    ctx.rotate(angle);const recoil=(flash.get(p.id)||0)>time?3:0;ctx.fillStyle='#07121c';ctx.fillRect(0,-4,23-recoil,8);ctx.fillStyle='#d2e4db';ctx.fillRect(0,-2,23-recoil,4);ctx.fillStyle='#78958b';ctx.fillRect(18-recoil,-4,5,8);circle(0,0,8,'#243d42');circle(-1,-1,6,color);ctx.fillStyle='#fff5';ctx.fillRect(-4,-4,6,2);
    if(recoil){ctx.fillStyle='#fff5b6';ctx.beginPath();ctx.moveTo(21,0);ctx.lineTo(31,-7);ctx.lineTo(28,-1);ctx.lineTo(37,0);ctx.lineTo(28,2);ctx.lineTo(31,7);ctx.closePath();ctx.fill();}ctx.restore();
    ctx.fillStyle='#08151ccc';ctx.fillRect(x-15,y-24,30,4);ctx.fillStyle=p.hp===1?'#ff9b7f':color;ctx.fillRect(x-15,y-24,p.hp*10,4);
    ctx.font=mine?'bold 9px sans-serif':'9px sans-serif';ctx.textAlign='center';ctx.fillStyle=mine?'#f4ffdd':'#c4d5d9';ctx.fillText(mine?'TÚ':p.name.slice(0,12),x,y-29);
  }
  function overlay(){
    if(!room)return;const p=self(),now=serverNow(),remaining=room.startsAt-now,dead=room.status==='playing'&&p.hp===0;
    const show=room.status!=='playing'||remaining>0||dead;$('battle-overlay').hidden=!show;$('battle-overlay').classList.toggle('countdown',room.status==='playing');
    if(room.status==='lobby'){$('overlay-label').textContent='LA ARENA TE ESPERA';$('overlay-title').textContent='Reúne a tu escuadrón';$('overlay-detail').textContent='Comparte el código de arriba. Cuando estén listos, el anfitrión inicia la ronda.';}
    else if(room.status==='finished'){const winners=room.players.filter(q=>room.winnerIds.includes(q.id));$('overlay-label').textContent=room.winnerIds.includes(room.youId)?'MISIÓN CUMPLIDA':'FIN DEL COMBATE';$('overlay-title').textContent=winners.length>1?'¡Empate!':winners[0]?.name||'Sin ganador';$('overlay-detail').textContent=winners.length>1?winners.map(q=>q.name).join(' · '):`${winners[0]?.score||0} bajas · ${p.score} bajas y ${p.deaths} caídas en tu marcador.`;}
    else if(remaining>0){$('overlay-label').textContent='PREPARA TU TANQUE';$('overlay-title').textContent=Math.ceil(remaining/1000);$('overlay-detail').textContent='WASD mueve · Flechas apuntan · Espacio dispara';}
    else if(dead){$('overlay-label').textContent='BLINDAJE DESTRUIDO';$('overlay-title').textContent=Math.max(1,Math.ceil((p.respawnAt-now)/1000));$('overlay-detail').textContent='Volverás con dos segundos de protección.';}
  }
  function draw(time){
    const dt=Math.min(40,Math.max(0,time-lastFrame));lastFrame=time;
    if(room){
      const now=serverNow(),p=self(),seconds=Math.max(0,Math.ceil((room.endsAt-Math.max(room.startsAt,now))/1000));$('clock').textContent=room.status==='finished'?'FINAL':room.status==='lobby'?'03:00':`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;$('clock').parentElement.classList.toggle('urgent',room.status==='playing'&&seconds<30);
      const reload=Math.min(1,Math.max(0,(now-p.lastFire)/500));$('reload-fill').style.width=reload*100+'%';$('reload-label').textContent=reload===1?'CAÑÓN LISTO':'RECARGANDO';overlay();
      $('hit-indicator').classList.toggle('show',time<hitUntil);ctx.setTransform(2,0,0,2,0,0);ctx.clearRect(0,0,840,600);ctx.drawImage(terrain,0,0);
      const age=Math.max(0,time-received),fraction=Math.min(1,age/75),a=input();
      room.players.forEach((q,i)=>{
        if(q.left||q.hp===0){if(q.id===room.youId)visual=null;return;}
        const old=previous?.players.find(t=>t.id===q.id),smooth=old&&old.hp>0&&Math.hypot(old.x-q.x,old.y-q.y)<60;
        let x=smooth?old.x+(q.x-old.x)*fraction:q.x,y=smooth?old.y+(q.y-old.y)*fraction:q.y,angle=q.aim;
        if(q.id===room.youId){
          const active=room.status==='playing'&&now>=room.startsAt&&age<300&&!busy;
          const target=active?TankMotion.move(room.map,q,a.x,a.y,Math.min(120,age+latency/2)):q;
          if(!visual||Math.hypot(visual.x-target.x,visual.y-target.y)>55)visual={x:target.x,y:target.y};
          else{const n=active?TankMotion.move(room.map,visual,a.x,a.y,dt):visual;const blend=1-Math.exp(-dt/55);const corrected={x:n.x+(target.x-n.x)*blend,y:n.y+(target.y-n.y)*blend};visual=TankMotion.wall(room.map,corrected.x,corrected.y)?{x:target.x,y:target.y}:corrected;}
          x=visual.x;y=visual.y;if(a.aimX||a.aimY)angle=Math.atan2(a.aimY,a.aimX);
          if(active){let distance=24;while(distance<145&&!TankMotion.wall(room.map,x+Math.cos(angle)*distance,y+Math.sin(angle)*distance,3))distance+=4;ctx.strokeStyle='#dbefb265';ctx.lineWidth=1;ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(x+Math.cos(angle)*24,y+Math.sin(angle)*24);ctx.lineTo(x+Math.cos(angle)*distance,y+Math.sin(angle)*distance);ctx.stroke();ctx.setLineDash([]);circle(x+Math.cos(angle)*distance,y+Math.sin(angle)*distance,3,null,'#e7f1b3aa');}
        }
        tank(q,x,y,angle,i,time);
      });
      for(const b of room.bullets){const ahead=Math.min(65,age)/1000,x=b.x+b.vx*ahead,y=b.y+b.vy*ahead;if(TankMotion.wall(room.map,x,y,3))continue;const angle=Math.atan2(b.vy,b.vx);ctx.strokeStyle='#ffb55766';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x-Math.cos(angle)*14,y-Math.sin(angle)*14);ctx.lineTo(x,y);ctx.stroke();circle(x,y,3,'#fff0bb');}
      particles=particles.filter(s=>s.life>0);for(const s of particles){s.life-=dt/1000;s.x+=s.vx*dt/1000;s.y+=s.vy*dt/1000;s.vx*=.98;s.vy*=.98;ctx.globalAlpha=Math.max(0,s.life/s.max);ctx.fillStyle=s.color;ctx.fillRect(s.x,s.y,s.size,s.size);}ctx.globalAlpha=1;
      ripples=ripples.filter(s=>s.until>time);for(const s of ripples){const life=(s.until-time)/650;ctx.globalAlpha=life;ctx.lineWidth=2;circle(s.x,s.y,7+(1-life)*36,null,s.color);}ctx.globalAlpha=1;
      if(time<damageUntil&&!reduced){ctx.strokeStyle='#ff785a88';ctx.lineWidth=14;ctx.strokeRect(7,7,826,586);}
    }
    requestAnimationFrame(draw);
  }
  const invite=new URLSearchParams(location.search).get('tanques');if(invite)$('code').value=invite.slice(0,6);
  try{const saved=JSON.parse(sessionStorage.getItem(storage));if(saved?.code&&saved?.token)session=saved;}catch{}
  if(session)action(async()=>render(await api('/'+session.code)));wake();requestAnimationFrame(draw);
})();
