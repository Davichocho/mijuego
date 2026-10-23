const test = require('node:test');
const assert = require('node:assert/strict');
const base = (process.env.CAMPO_TEST_URL || 'http://127.0.0.1:5080').replace(/\/$/,'');
async function call(path, body, token, expected=200) {
  const r=await fetch(base+'/api/skee/rooms'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(r.status,expected);return r.json();
}
test('Skee-Ball HTTP: eight simultaneous players, server scores, duplicates, winner and rematch',async()=>{
  for(const asset of ['/skeeball.html','/skeeball.js','/skeeball.css']) assert.equal((await fetch(base+asset)).status,200);
  const host=await call('',{name:'Ana',maxPlayers:8,durationSeconds:0});
  const path='/'+host.code, people=[host];
  for(let i=1;i<8;i++)people.push(await call(path+'/join',{name:'Jugador '+i}));
  await call(path+'/join',{name:'Extra'},null,409);
  await call(path,undefined,null,401);
  await call(path+'/start',{round:0},people[1].token,403);
  await call(path+'/start',{round:0},host.token);
  const shots=await Promise.all(people.map(p=>call(path+'/shot',{round:0,number:1,aim:0,power:50/345,points:99999},p.token)));
  assert.ok(shots.every(s=>s.players.find(p=>p.id===s.youId).score===10));
  await call(path+'/shot',{round:0,number:1,aim:0,power:1},host.token);
  const state=await call(path,undefined,host.token);assert.ok(state.players.every(p=>p.shots.length===1&&p.score===10));
  assert.ok(state.players.every(p=>!('token' in p)));
  await call(path+'/shot',{round:0,number:3,aim:0,power:1},host.token,409);
  for(const p of people.slice(1))await call(path+'/leave',{},p.token);
  for(let number=2;number<=9;number++){
    await new Promise(resolve=>setTimeout(resolve,1150));
    await call(path+'/shot',{round:0,number,aim:-.75,power:310/345},host.token);
  }
  const final=await call(path,undefined,host.token);
  assert.equal(final.status,'finished');assert.equal(final.players[0].score,810);assert.deepEqual(final.winnerIds,[host.room.youId]);
  const next=await call(path+'/rematch',{round:0},host.token);assert.equal(next.round,1);assert.equal(next.players[0].score,0);
  await call(path+'/shot',{round:0,number:1,aim:0,power:.5},host.token,409);
  await call(path+'/leave',{},host.token);
});
