(() => {
  'use strict';
  const host=document.createElement('div');host.id='room-chat';host.hidden=true;
  host.innerHTML=`<button class="chat-launch" type="button" aria-expanded="false" aria-controls="room-chat-panel">Chat de sala <span class="chat-unread" hidden></span></button><section id="room-chat-panel" hidden aria-label="Chat de la sala"><header class="chat-heading"><div><strong>Chat de sala</strong><small class="chat-code"></small></div><button type="button" class="chat-close" aria-label="Cerrar chat">×</button></header><div class="chat-log" role="log" aria-label="Mensajes" aria-live="polite" aria-relevant="additions"></div><p class="chat-note">Solo los jugadores de esta sala · últimos 60 mensajes</p><form class="chat-form"><label class="chat-label" for="room-chat-input">Mensaje</label><input id="room-chat-input" type="text" maxlength="280" autocomplete="off" placeholder="Escribe a tus amigos…" required><button type="submit">Enviar ↗</button></form><p class="chat-error" role="status"></p></section>`;
  document.body.append(host);
  const find=s=>host.querySelector(s),panel=find('#room-chat-panel'),log=find('.chat-log'),field=find('input'),send=find('.chat-form button'),launcher=find('.chat-launch'),badge=find('.chat-unread');
  let session=null,epoch=0,cursor=0,latest=0,unread=0,loaded=false,timer=null,polling=false,sending=false,draft=null;
  const requests=new Set(),ids=new Set();
  function uuid(){const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;return [...a].map(v=>v.toString(16).padStart(2,'0')).join('');}
  function notice(text=''){find('.chat-error').textContent=text;}
  function open(value=true){if(!session)return;panel.hidden=!value;launcher.setAttribute('aria-expanded',String(value));if(value){unread=0;badge.hidden=true;document.dispatchEvent(new CustomEvent('campo-chat-focus'));field.focus();log.scrollTop=log.scrollHeight;}}
  launcher.onclick=()=>open(panel.hidden);find('.chat-close').onclick=()=>{open(false);launcher.focus();};
  host.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();open(false);launcher.focus();}});
  host.addEventListener('keyup',e=>e.stopPropagation());
  function attach(value){if(session?.base===value.base&&session?.code===value.code&&session?.token===value.token)return;
    detach();session={...value};host.hidden=false;find('.chat-code').textContent='SALA '+session.code;timer=setTimeout(poll,0);
  }
  function detach(){epoch++;session=null;clearTimeout(timer);for(const c of requests)c.abort();requests.clear();cursor=latest=unread=0;loaded=false;ids.clear();log.replaceChildren();field.value='';draft=null;notice();host.hidden=true;panel.hidden=true;badge.hidden=true;launcher.setAttribute('aria-expanded','false');send.disabled=false;sending=polling=false;}
  async function request(body,context){const controller=new AbortController();requests.add(controller);const timeout=setTimeout(()=>controller.abort(),7000);
    try{const url=context.base+'/'+encodeURIComponent(context.code)+'/chat'+(body?'':'?after='+cursor);const r=await fetch(url,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+context.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});const data=await r.json();if(!r.ok){const e=new Error(data.error||'No se pudo conectar al chat.');e.status=r.status;throw e;}return data;}
    finally{clearTimeout(timeout);requests.delete(controller);}}
  function receive(data){const bottom=log.scrollTop+log.clientHeight>=log.scrollHeight-45;let count=0;
    for(const m of data.messages){if(ids.has(m.id)||m.id<=latest)continue;ids.add(m.id);const item=document.createElement('article'),head=document.createElement('div'),name=document.createElement('strong'),time=document.createElement('time'),text=document.createElement('p');item.dataset.id=m.id;item.className='chat-message'+(m.playerId===data.youId?' mine':'');name.textContent=m.name;time.textContent=new Date(m.at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});text.textContent=m.text;head.append(name,time);item.append(head,text);const next=[...log.children].find(row=>Number(row.dataset.id)>m.id);log.insertBefore(item,next||null);if(loaded&&m.playerId!==data.youId)count++;cursor=Math.max(cursor,m.id);}
    while(log.children.length>60){ids.delete(Number(log.firstChild.dataset.id));log.firstChild.remove();}
    latest=Math.max(latest,data.latestId);cursor=Math.max(cursor,latest);if(panel.hidden)unread+=count;else unread=0;
    badge.textContent=String(unread);badge.hidden=!unread;if(bottom||!loaded)log.scrollTop=log.scrollHeight;loaded=true;
  }
  async function poll(){if(!session||polling)return;polling=true;const current=epoch,context=session;let delay=1400;
    try{const data=await request(undefined,context);if(current!==epoch)return;receive(data);if(!sending&&find('.chat-error').textContent.startsWith('Sin conexión'))notice();}
    catch(e){if(current!==epoch)return;if(e.status===401||e.status===404){detach();return;}notice('Sin conexión al chat. Reintentando…');delay=3000;}
    finally{if(current===epoch){polling=false;if(session)timer=setTimeout(poll,delay);}}}
  find('form').onsubmit=async e=>{e.preventDefault();if(!session||sending)return;const text=field.value.trim();if(!text)return;if(!draft||draft.text!==text)draft={text,clientId:uuid()};const current=epoch,context=session,body=draft;sending=true;send.disabled=true;notice();
    try{const data=await request(body,context);if(current!==epoch)return;receive(data);if(field.value.trim()===text)field.value='';draft=null;log.scrollTop=log.scrollHeight;field.focus();}
    catch(e){if(current!==epoch)return;notice(e.name==='AbortError'||e instanceof TypeError?'No se confirmó el envío. Puedes reintentar sin duplicarlo.':e.message);}
    finally{if(current===epoch){sending=false;send.disabled=false;}}};
  window.RoomChat=Object.freeze({attach,detach,open,isOpen:()=>!!session&&!panel.hidden});
})();
