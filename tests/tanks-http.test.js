const test=require('node:test'),assert=require('node:assert/strict');
const base=(process.env.CAMPO_TEST_URL||'http://127.0.0.1:5080').replace(/\/$/,'');
async function req(path,body,token,status=200){const r=await fetch(base+'/api/tanks/rooms'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.equal(r.status,status);return r.json();}
test('Tank API: eight players, controls, host permissions, shared state and rematch',async()=>{
 for(const asset of ['/tanks.html','/tanks.css','/tanks.js','/tank-motion.js'])assert.equal((await fetch(base+asset)).status,200);
 const a=await req('',{name:'Ana',maxPlayers:8}),path='/'+a.code,players=[a];for(let i=1;i<8;i++)players.push(await req(path+'/join',{name:'Player '+i}));
 await req(path+'/join',{name:'Extra'},null,409);await req(path,undefined,null,401);await req(path+'/start',{round:0},players[1].token,403);const start=await req(path+'/start',{round:0},a.token);assert.ok(start.startsAt-start.serverTime>2000&&start.startsAt-start.serverTime<=3000);assert.equal(start.endsAt-start.startsAt,180000);
 const states=await Promise.all(players.map(p=>req(path+'/input',{round:0,sequence:1,x:0,y:0,aimX:0,aimY:1,fire:true},p.token)));
 assert.ok(states.every(s=>s.players.length===8&&s.map.length===15&&s.events.length===0&&s.bullets.length===0));assert.ok(states.every(s=>s.players.every(p=>!('token' in p))));
 const state=await req(path,undefined,a.token);assert.ok(state.players.every(p=>Math.abs(p.aim-Math.PI/2)<.001));
 await req(path+'/input',{round:0,sequence:2,x:10,y:0,aimX:0,aimY:0,fire:false},a.token,400);
 for(const p of players.slice(1))await req(path+'/leave',{},p.token);
 const end=await req(path,undefined,a.token);assert.equal(end.status,'finished');assert.deepEqual(end.winnerIds,[a.room.youId]);
 const next=await req(path+'/rematch',{round:0},a.token);assert.equal(next.round,1);assert.equal(next.status,'lobby');await req(path+'/leave',{},a.token);
});
