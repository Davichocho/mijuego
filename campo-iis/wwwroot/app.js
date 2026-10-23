const $=selector=>document.querySelector(selector);
const levels={easy:{rows:9,cols:9,mines:10,title:'Un paseo por el campo'},medium:{rows:16,cols:16,mines:40,title:'Un desafío con calma'},hard:{rows:16,cols:30,mines:99,title:'Explora sin miedo'}};
let selectedLevel='easy',selectedMode='solo',activeMode='solo',activeLevel='easy';
let game,startedAt=null,elapsed=0,flagMode=false,turn=0,scores=[0,0],names=[],buttons=[],exploded;
function setTheme(color,name){
  if(!/^#[0-9a-f]{6}$/i.test(color))return;
  document.documentElement.style.setProperty('--accent',color);
  document.documentElement.style.setProperty('--tint',`color-mix(in srgb, ${color}, white 87%)`);
  const rgb=color.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  document.documentElement.style.setProperty('--accent-ink',rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>.179?'#17200e':'#ffffff');
  $('#theme-name').textContent=name;$('#custom-color').value=color;
  document.querySelectorAll('.swatch').forEach(b=>{const active=b.dataset.color===color;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active);});
  try{localStorage.setItem('campo-theme',JSON.stringify({color,name}));}catch{}
}
document.querySelectorAll('.swatch').forEach(b=>b.addEventListener('click',()=>setTheme(b.dataset.color,b.dataset.name)));
$('#custom-color').addEventListener('input',e=>setTheme(e.target.value,'Tu color'));
try{const theme=JSON.parse(localStorage.getItem('campo-theme'));if(theme&&typeof theme.name==='string')setTheme(theme.color,theme.name);}catch{}
document.querySelectorAll('[data-level]').forEach(button=>button.addEventListener('click',()=>{
  selectedLevel=button.dataset.level;
  document.querySelectorAll('[data-level]').forEach(b=>{const active=b===button;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active);});
  $('#new-game span').textContent='Aplicar y empezar';
}));
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{
  selectedMode=button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(b=>{const active=b===button;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',active);});
  $('#players').hidden=selectedMode!=='duo';$('#new-game span').textContent='Aplicar y empezar';
}));
function newGame(restart=false){
  if(!restart){activeLevel=selectedLevel;activeMode=selectedMode;names=[$('#name-one').value.trim()||'Jugador 1',$('#name-two').value.trim()||'Jugador 2'];}
  const config=levels[activeLevel];game=new Minesweeper(config.rows,config.cols,config.mines);
  scores=[0,0];turn=0;startedAt=null;elapsed=0;exploded=undefined;
  $('#timer').textContent='00:00';$('#game-title').textContent=config.title;$('#scoreboard').hidden=activeMode!=='duo';
  $('#board').style.setProperty('--cols',config.cols);$('#board').replaceChildren();buttons=[];
  game.cells.forEach((_,i)=>{
    const button=document.createElement('button');button.className='cell';button.type='button';
    button.addEventListener('click',()=>flagMode?toggleFlag(i):reveal(i));
    button.addEventListener('contextmenu',event=>{event.preventDefault();toggleFlag(i);});
    button.addEventListener('keydown',event=>{
      const offsets={ArrowUp:-game.cols,ArrowDown:game.cols,ArrowLeft:-1,ArrowRight:1};
      if(event.key in offsets){event.preventDefault();const target=i+offsets[event.key];if(target>=0&&target<buttons.length)buttons[target].focus();}
    });
    buttons.push(button);$('#board').append(button);
  });
  flagMode=false;$('#flag-mode').setAttribute('aria-pressed','false');
  if(!restart)$('#new-game span').textContent='Nueva partida';
  render();
}
function toggleFlag(index){if(game.flag(index))render();}
function reveal(index){
  const result=game.reveal(index);if(!result.changed)return;
  if(startedAt===null)startedAt=Date.now();scores[turn]+=result.count*10;
  if(game.status==='playing'&&activeMode==='duo')turn=1-turn;
  if(['won','lost'].includes(game.status)){elapsed=Date.now()-startedAt;exploded=result.hit;updateTimer();}
  render();
}
function render(){
  const ended=['won','lost'].includes(game.status);
  game.cells.forEach((cell,i)=>{
    const button=buttons[i],showMine=ended&&cell.mine;button.className='cell';button.textContent='';delete button.dataset.number;
    let description='sin descubrir';
    if(cell.open||showMine){
      button.classList.add('revealed');
      if(cell.mine){button.classList.add('mine');button.textContent='✳';description='mina';}
      else if(cell.adjacent){button.textContent=cell.adjacent;button.dataset.number=cell.adjacent;description=`${cell.adjacent} minas alrededor`;}
      else description='vacía';
    }else if(cell.flag){button.classList.add('flagged');button.textContent='⚑';description='bandera';}
    if(ended&&cell.flag&&!cell.mine){button.classList.add('wrong');button.textContent='×';description='bandera incorrecta';}
    if(i===exploded)button.classList.add('exploded');
    button.setAttribute('aria-label',`Fila ${Math.floor(i/game.cols)+1}, columna ${i%game.cols+1}: ${description}`);
    button.setAttribute('aria-disabled',ended||cell.open?'true':'false');
  });
  $('#remaining').textContent=String(game.mines-game.flags).padStart(3,'0');
  const status=$('#game-message');status.classList.toggle('result',ended);
  let message=game.started?'Observa los números. La próxima pista está cerca.':'✧ Todo comienza con una casilla. Elige la tuya.';
  if(activeMode==='duo'){
    [$('#player-one'),$('#player-two')].forEach((el,i)=>{el.textContent=`${names[i]} · ${scores[i]} pts`;el.classList.toggle('active',i===turn&&!ended);});
    message=`Turno de ${names[turn]}. Descubre una casilla.`;
  }
  if(game.status==='lost')message=activeMode==='duo'?`¡${names[1-turn]} gana! ${names[turn]} encontró una mina.`:'¡Una mina! Cada partida enseña algo. Vuelve a intentarlo.';
  if(game.status==='won')message=activeMode==='duo'?(scores[0]===scores[1]?'¡Campo despejado! Empate. Gran trabajo en equipo.':`¡Campo despejado! ${names[scores[0]>scores[1]?0:1]} gana con ${Math.max(...scores)} puntos.`):'¡Lo lograste! Campo despejado. Una victoria bien pensada.';
  status.textContent=message;$('#game-badge').textContent=ended?(game.status==='won'?'✧ Campo despejado':'Partida terminada'):(game.started?'● En juego':'● A tu ritmo');
}
function updateTimer(){
  const seconds=Math.floor((game.status==='playing'&&startedAt!==null?Date.now()-startedAt:elapsed)/1000);
  $('#timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
setInterval(updateTimer,1000);
$('#new-game').addEventListener('click',()=>newGame());$('#restart').addEventListener('click',()=>newGame(true));
$('#flag-mode').addEventListener('click',()=>{flagMode=!flagMode;$('#flag-mode').setAttribute('aria-pressed',String(flagMode));});
const help=$('#help-dialog');
['#help-open','#help-bottom'].forEach(id=>$(id).addEventListener('click',()=>help.showModal()));
['#help-close','#help-ready'].forEach(id=>$(id).addEventListener('click',()=>help.close()));
help.addEventListener('click',event=>{if(event.target===help){const r=help.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)help.close();}});
newGame();

