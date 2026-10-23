const test=require('node:test'),assert=require('node:assert/strict');
const {wall,move}=require('../tank-motion.js');
const map=Array.from({length:15},(_,y)=>y===0||y===14?'#'.repeat(21):'#'+'.'.repeat(19)+'#');
test('Tank prediction preserves diagonal speed and stops at exterior walls',()=>{
 const start={x:100,y:100},straight=move(map,start,1,0,100),diagonal=move(map,start,1,1,100);
 assert.equal(straight.x,115);assert.ok(Math.abs(Math.hypot(diagonal.x-100,diagonal.y-100)-15)<.001);
 const blocked=move(map,{x:55,y:60},-1,0,300);assert.ok(blocked.x>=50&&blocked.x<55);assert.equal(blocked.y,60);
 assert.equal(wall(map,-20,10),true);
});
test('Tank prediction uses axis sliding, cannot tunnel through cover and bounds extrapolation',()=>{
 const covered=[...map];covered[2]='#...#...............#';covered[3]=covered[2];
 const p=move(covered,{x:140,y:100},1,1,300);assert.ok(p.x<=150&&p.y>100);
 assert.deepEqual(move(map,{x:100,y:100},1,0,5000),move(map,{x:100,y:100},1,0,300));
 assert.deepEqual(move(map,{x:100,y:100},0,0,100),{x:100,y:100});
});
