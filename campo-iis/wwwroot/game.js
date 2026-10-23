(function(root){
class Minesweeper {
  constructor(rows,cols,mines,random=Math.random){
    this.rows=rows;this.cols=cols;this.mines=mines;this.random=random;
    this.cells=Array.from({length:rows*cols},()=>({mine:false,open:false,flag:false,adjacent:0}));
    this.started=false;this.status='ready';this.opened=0;
  }
  neighbors(index){
    const row=Math.floor(index/this.cols),col=index%this.cols,result=[];
    for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){
      if((x||y)&&row+y>=0&&row+y<this.rows&&col+x>=0&&col+x<this.cols)result.push((row+y)*this.cols+col+x);
    }
    return result;
  }
  seed(first){
    const excluded=new Set([first,...this.neighbors(first)]);
    const candidates=this.cells.map((_,i)=>i).filter(i=>!excluded.has(i));
    for(let i=candidates.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
    candidates.slice(0,this.mines).forEach(i=>{this.cells[i].mine=true;});
    this.cells.forEach((cell,i)=>{cell.adjacent=this.neighbors(i).filter(n=>this.cells[n].mine).length;});
    this.started=true;this.status='playing';
  }
  flag(index){
    const cell=this.cells[index];
    if(!cell||cell.open||['won','lost'].includes(this.status))return false;
    if(!cell.flag&&this.flags>=this.mines)return false;
    cell.flag=!cell.flag;return true;
  }
  get flags(){return this.cells.filter(c=>c.flag).length;}
  reveal(index){
    const cell=this.cells[index];
    if(!cell||cell.open||cell.flag||['won','lost'].includes(this.status))return {changed:false,count:0};
    if(!this.started)this.seed(index);
    if(cell.mine){cell.open=true;this.status='lost';return {changed:true,count:0,hit:index};}
    let count=0;const queue=[index];
    while(queue.length){
      const current=queue.pop(),next=this.cells[current];
      if(next.open||next.flag||next.mine)continue;
      next.open=true;count++;this.opened++;
      if(next.adjacent===0)queue.push(...this.neighbors(current));
    }
    if(this.opened===this.cells.length-this.mines)this.status='won';
    return {changed:true,count};
  }
}
if(typeof module!=='undefined'&&module.exports)module.exports=Minesweeper;else root.Minesweeper=Minesweeper;
})(globalThis);
