/* Shared client motion: prediction uses the same radius, speed and axis collision as the server. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.TankMotion=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  function wall(map,x,y,radius=10){for(let yy=Math.floor((y-radius)/40);yy<=Math.floor((y+radius)/40);yy++)for(let xx=Math.floor((x-radius)/40);xx<=Math.floor((x+radius)/40);xx++)if(!map[yy]||map[yy][xx]!=='.')return true;return false;}
  function move(map,position,x,y,ms){const p={x:position.x,y:position.y},factor=x&&y?Math.SQRT1_2:1;let remaining=Math.max(0,Math.min(ms,300));while(remaining>0){const dt=Math.min(10,remaining),dx=x*.15*dt*factor,dy=y*.15*dt*factor;if(!wall(map,p.x+dx,p.y))p.x+=dx;if(!wall(map,p.x,p.y+dy))p.y+=dy;remaining-=dt;}return p;}
  return {wall,move};
});
