const {test}=require('node:test');
const assert=require('node:assert/strict');
const Minesweeper=require('./game.js');
for(const [rows,cols,mines] of [[9,9,10],[16,16,40],[16,30,99]]){
  test(`Campo ${rows}x${cols}: minas exactas, pistas y primera jugada segura`,()=>{
    for(const first of [0,Math.floor(rows/2)*cols+Math.floor(cols/2),rows*cols-1]){
      const game=new Minesweeper(rows,cols,mines);game.reveal(first);
      assert.equal(game.cells.filter(c=>c.mine).length,mines);
      for(const i of [first,...game.neighbors(first)])assert.equal(game.cells[i].mine,false);
      game.cells.forEach((c,i)=>assert.equal(c.adjacent,game.neighbors(i).filter(n=>game.cells[n].mine).length));
      assert.ok(game.opened>0);assert.equal(game.cells.filter(c=>c.open&&c.mine).length,0);
    }
  });
}
test('Banderas: límite, casillas protegidas y retirada',()=>{
  const game=new Minesweeper(9,9,10);
  for(let i=0;i<10;i++)assert.equal(game.flag(i),true);
  assert.equal(game.flag(10),false);assert.equal(game.flags,10);
  assert.equal(game.reveal(0).changed,false);assert.equal(game.started,false);
  assert.equal(game.flag(0),true);assert.equal(game.flags,9);
  game.reveal(0);assert.equal(game.flag(0),false);
});
test('Victoria al descubrir todas las casillas seguras y bloqueo posterior',()=>{
  const game=new Minesweeper(9,9,10);game.reveal(40);
  game.cells.forEach((c,i)=>{if(!c.mine)game.reveal(i);});
  assert.equal(game.status,'won');assert.equal(game.opened,71);
  const mine=game.cells.findIndex(c=>c.mine);
  assert.equal(game.reveal(mine).changed,false);assert.equal(game.flag(mine),false);
});
test('Derrota al descubrir una mina y bloqueo posterior',()=>{
  const game=new Minesweeper(9,9,10);game.reveal(40);
  const mine=game.cells.findIndex(c=>c.mine);assert.equal(game.reveal(mine).hit,mine);
  assert.equal(game.status,'lost');
  assert.equal(game.reveal(game.cells.findIndex(c=>!c.open)).changed,false);
});
test('La expansión no abre casillas marcadas',()=>{
  const game=new Minesweeper(9,9,10);game.flag(41);game.reveal(40);
  assert.equal(game.cells[41].open,false);game.flag(41);game.reveal(41);
  assert.equal(game.cells[41].open,true);
});
