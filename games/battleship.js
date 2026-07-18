import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SB_URL='https://iwwodozxqsgbaghndncs.supabase.co';
const SB_KEY='sb_publishable_dMtLijCoMrB4S7b6esp4oQ_ICgLZX0x';
const sb=createClient(SB_URL,SB_KEY);

function uid(){return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));}
let token=localStorage.getItem('arc_token'); if(!token){token=uid();localStorage.setItem('arc_token',token);}
let name=localStorage.getItem('arc_name')||'';
let code='';

const FLEET=[{name:'carrier',len:5,label:'Carrier'},{name:'battleship',len:4,label:'Battleship'},
  {name:'cruiser',len:3,label:'Cruiser'},{name:'submarine',len:3,label:'Submarine'},{name:'destroyer',len:2,label:'Destroyer'}];

let app, chip, exitToMenu;
let S=null, err='', poll=null, lastSig='';
let placement={}; // name -> {cells:[[r,c],...], orientation} once placed
let trayOrientation={}; // name -> 'h'|'v', for ships still in the tray, set via rotate button
let boardTab='fire'; // 'fire' | 'fleet' — which grid the play screen shows
let drag=null; // active drag state, or null when not dragging

const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function rpc(fn,args){const{data,error}=await sb.rpc(fn,args); if(error) throw new Error((error.message||'').replace(/^.*?:\s*/,'')||'error'); return data;}
const FR={GAME_NOT_FOUND:'No game with that code. Check it and try again.',GAME_FULL:'That game is already full.',
  NOT_YOUR_TURN:'Hold on — it’s not your turn yet.',NOT_PLAYING:'The game isn’t ready yet.',
  LOCKED:'The game already started — fleets are locked.',NOT_A_PLAYER:'You’re not in this game anymore.',
  BAD_SHIP_LAYOUT:'That fleet layout isn’t valid — ships must fit the grid without overlapping.',
  OUT_OF_RANGE:'That’s off the grid.',ALREADY_FIRED:'You already fired there.'};
const fr=m=>FR[m]||m||'Something went wrong.';

function P(){ return S?.players||[]; }
function me(){ return P().find(p=>p.slot===S.my_slot); }
function opp(){ return P().find(p=>p.slot!==S.my_slot); }
function oppSlot(){ return S.my_slot===1?2:1; }
function bs(){ return S?.bs_view || {my_ships:[],my_shots:[],incoming_shots:[],sunk_mine:[],sunk_theirs:[]}; }

// ---- ship placement helpers ----
function shipCells(len,r,c,orient){
  const cells=[]; for(let i=0;i<len;i++) cells.push(orient==='h'?[r,c+i]:[r+i,c]);
  return cells;
}
function allPlacedCells(exclude){
  const out=[];
  for(const shipName in placement){ if(shipName===exclude) continue; out.push(...placement[shipName].cells); }
  return out;
}
function cellsValid(cells, exclude){
  const placed = allPlacedCells(exclude);
  for(const [r,c] of cells){
    if(r<0||r>9||c<0||c>9) return false;
    if(placed.some(([pr,pc])=>pr===r&&pc===c)) return false;
  }
  return true;
}
function clearShip(shipName){
  delete placement[shipName];
  if(!trayOrientation[shipName]) trayOrientation[shipName]='h';
  render();
}

async function createGame(){
  err='';
  try{ code=await rpc('arc_create_game',{p_type:'battleship',p_config:{},p_name:name,p_token:token}); await refresh(true); startPoll(); }
  catch(e){err=fr(e.message);render();}
}
async function joinGame(){
  err='';
  const cd=(document.getElementById('codeIn')?.value||'').trim().toUpperCase();
  if(cd.length<4){err='Enter the 4-letter game code.';return render();}
  try{ await rpc('arc_join_game',{p_code:cd,p_name:name,p_token:token}); code=cd; await refresh(true); startPoll(); }
  catch(e){err=fr(e.message);render();}
}
async function lockFleet(){
  err='';
  if(FLEET.some(f=>!placement[f.name])){ err='Place all 5 ships first.'; return render(); }
  const p_ships = FLEET.map(f=>({name:f.name, cells:placement[f.name].cells}));
  try{ await rpc('bs_set_ships',{p_code:code,p_token:token,p_ships}); await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function fireAt(r,c){
  err='';
  try{ await rpc('bs_fire',{p_code:code,p_token:token,p_row:r,p_col:c}); await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
function leaveGame(){ if(poll){clearInterval(poll);poll=null;} if(drag){drag.ghost.remove();drag=null;} code='';S=null;err='';lastSig='';placement={};trayOrientation={};boardTab='fire'; exitToMenu(); }
function playAgain(){ if(poll){clearInterval(poll);poll=null;} if(drag){drag.ghost.remove();drag=null;} code='';S=null;err='';lastSig='';placement={};trayOrientation={};boardTab='fire'; render(); }

function startPoll(){ if(poll) clearInterval(poll); poll=setInterval(()=>refresh(false),1500); }
async function refresh(force){
  if(!code) return;
  try{
    const d=await rpc('arc_state',{p_code:code,p_token:token}); S=d;
    const sig=[S.status,S.turn,S.winner,(S.bs_view?.my_shots||[]).length,(S.bs_view?.incoming_shots||[]).length,(S.players||[]).length].join('|');
    if(force||sig!==lastSig){lastSig=sig;render();}
    if(S.status==='finished'&&poll){clearInterval(poll);poll=null;}
  }catch(e){ if(/GAME_NOT_FOUND/.test(e.message)) leaveGame(); }
}

function viewSetup(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ Arcade menu</button>
  <div class="card">
    <p class="lede">Classic Battleship. Place your fleet on a 10×10 grid, then take turns firing at your opponent's waters. First to sink all 5 ships wins.</p>
    <label class="fld" for="nameIn">Your name</label>
    <input class="text" id="nameIn" maxlength="16" placeholder="e.g. ${esc(name||'You')}" value="${esc(name)}" />
    <div style="height:16px"></div>
    <button class="btn" id="createBtn">Start a new game</button>
    <div class="divider">or</div>
    <label class="fld" for="codeIn">Join with a code</label>
    <div class="row">
      <input class="text code" id="codeIn" maxlength="4" placeholder="CODE" autocapitalize="characters" />
      <button class="btn ghost" id="joinBtn" style="flex:0 0 96px">Join</button>
    </div>
  </div>`;
}

function gridCellStyle(extra){
  return `width:100%;aspect-ratio:1;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-sizing:border-box;${extra||''}`;
}
function gridWrapStyle(){
  return `display:grid;grid-template-columns:repeat(10,1fr);gap:2px;background:var(--line);border-radius:10px;overflow:hidden;padding:2px;touch-action:none;`;
}

function renderPlacementGrid(){
  const placedCells = allPlacedCells(null);
  let html = `<div id="placeGrid" style="${gridWrapStyle()}">`;
  for(let r=0;r<10;r++) for(let c=0;c<10;c++){
    const onShip = placedCells.some(([pr,pc])=>pr===r&&pc===c);
    html += `<div class="bscell" data-r="${r}" data-c="${c}" style="${gridCellStyle(onShip?'background:var(--ink);color:#fff;cursor:pointer':'background:#FCFAF5;')}"></div>`;
  }
  html += `</div>`;
  return html;
}
function renderTray(){
  const unplaced = FLEET.filter(f=>!placement[f.name]);
  if(!unplaced.length) return '';
  return `<div id="shipTray" style="display:flex; flex-direction:column; gap:10px; margin-bottom:14px">
    ${unplaced.map(f=>{
      const o = trayOrientation[f.name] || 'h';
      const squares = Array.from({length:f.len}).map(()=>`<div style="width:20px;height:20px;background:var(--ink);border-radius:4px;flex:none"></div>`).join('');
      return `<div class="traychip" data-ship="${f.name}" data-orient="${o}" style="display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;touch-action:none;cursor:grab">
        <div style="display:flex;flex-direction:${o==='h'?'row':'column'};gap:3px">${squares}</div>
        <div style="flex:1;font-size:13.5px;font-weight:600">${esc(f.label)} <span style="color:var(--muted);font-weight:500">(${f.len})</span></div>
        <button class="rotateBtn" data-rotate="${f.name}" style="border:1.5px solid var(--line);background:#FCFAF5;border-radius:8px;width:34px;height:34px;font-size:15px;cursor:pointer">↻</button>
      </div>`;
    }).join('')}
  </div>`;
}
function viewPlacement(){
  const allPlaced = FLEET.every(f=>placement[f.name]);
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="card">
    <div class="bigcode">${esc(S.code)}</div>
    <button class="copybtn" id="copyBtn">Copy game code</button>
    <div class="rosters">
      <div class="teambox mine"><h4>You</h4><ul><li>${esc(me()?.name||'You')}</li></ul>
        <span class="secflag">${me()?.ready?'✓ fleet locked':''}</span></div>
      <div class="teambox"><h4>Opponent</h4><ul>${opp()?`<li>${esc(opp().name)}</li>`:'<li class="w">waiting…</li>'}</ul>
        <span class="secflag">${opp()?.ready?'✓ fleet locked':''}</span></div>
    </div>
  </div>
  ${me()?.ready ? `<div class="card"><p class="lede" style="margin:0">Your fleet is locked in. Waiting on your opponent…</p></div>` : `
  <div class="card">
    <p class="lede" style="margin-bottom:10px">Drag a ship onto the grid to place it. Tap ↻ to rotate before dragging. Tap a placed ship to send it back.</p>
    ${renderTray()}
    ${renderPlacementGrid()}
    <div style="height:16px"></div>
    <button class="btn" id="lockFleetBtn" ${allPlaced?'':'disabled'}>Lock in my fleet</button>
  </div>`}
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">Leave game</button>`;
}

// ---- drag-and-drop placement (Pointer Events — unified mouse/touch) ----
function clearPreview(){
  document.querySelectorAll('#placeGrid .bscell').forEach(el=>{
    el.style.background = el.dataset.hasShip==='1' ? 'var(--ink)' : '#FCFAF5';
    el.style.color = el.dataset.hasShip==='1' ? '#fff' : '';
  });
}
function showPreview(cells, valid){
  clearPreview();
  const color = valid ? 'rgba(31,122,77,.35)' : 'rgba(226,86,59,.35)';
  cells.forEach(([r,c])=>{
    const el = document.querySelector(`#placeGrid .bscell[data-r="${r}"][data-c="${c}"]`);
    if(el) el.style.background = color;
  });
}
function cellUnderPoint(x,y){
  const el = document.elementFromPoint(x,y);
  const cell = el && el.closest ? el.closest('#placeGrid .bscell') : null;
  if(!cell) return null;
  return {r:+cell.dataset.r, c:+cell.dataset.c};
}
function startDrag(pointerId, shipName, len, orientation, origin, x, y){
  const ghost = document.createElement('div');
  ghost.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;z-index:9999;display:flex;flex-direction:${orientation==='h'?'row':'column'};gap:3px;transform:translate(-50%,-50%);`;
  for(let i=0;i<len;i++){
    const sq = document.createElement('div');
    sq.style.cssText = 'width:28px;height:28px;background:var(--tomato);border-radius:5px;box-shadow:0 4px 10px rgba(0,0,0,.25)';
    ghost.appendChild(sq);
  }
  document.body.appendChild(ghost);
  drag = { pointerId, shipName, len, orientation, origin, ghost };
  moveGhost(x,y);
}
function moveGhost(x,y){ if(drag) { drag.ghost.style.left = x+'px'; drag.ghost.style.top = y+'px'; } }
function updateDragPreview(x,y){
  if(!drag) return;
  moveGhost(x,y);
  const anchor = cellUnderPoint(x,y);
  if(!anchor){ clearPreview(); drag.lastCells=null; drag.lastValid=false; return; }
  const cells = shipCells(drag.len, anchor.r, anchor.c, drag.orientation);
  const valid = cellsValid(cells, drag.origin==='grid'?drag.shipName:null);
  showPreview(cells, valid);
  drag.lastCells = cells; drag.lastValid = valid;
}
function endDrag(){
  if(!drag) return;
  const { shipName, orientation, origin, lastCells, lastValid, ghost } = drag;
  ghost.remove();
  clearPreview();
  if(lastValid && lastCells){
    placement[shipName] = { cells: lastCells, orientation };
  } else if(origin==='grid'){
    // dropped somewhere invalid after picking it up from the grid — it's already removed
    // from `placement` (see pointerdown handler below), so it just returns to the tray.
  }
  drag = null;
  render();
}
function initPlacementDrag(){
  const grid = document.getElementById('placeGrid');
  if(!grid) return;
  // mark which cells currently belong to a placed ship, for preview color restoration
  document.querySelectorAll('#placeGrid .bscell').forEach(el=>{ el.dataset.hasShip = (el.style.background==='var(--ink)')?'1':'0'; });

  document.querySelectorAll('.traychip').forEach(chip=>{
    chip.addEventListener('pointerdown', e=>{
      if(e.target.closest('.rotateBtn')) return; // rotate button handles its own tap
      const shipName = chip.dataset.ship;
      const ship = FLEET.find(f=>f.name===shipName);
      const orientation = trayOrientation[shipName] || 'h';
      try{ chip.setPointerCapture(e.pointerId); }catch(err){}
      startDrag(e.pointerId, shipName, ship.len, orientation, 'tray', e.clientX, e.clientY);
      const onMove = ev => { if(ev.pointerId===e.pointerId) updateDragPreview(ev.clientX, ev.clientY); };
      const onUp = ev => {
        if(ev.pointerId!==e.pointerId) return;
        chip.removeEventListener('pointermove', onMove);
        chip.removeEventListener('pointerup', onUp);
        chip.removeEventListener('pointercancel', onUp);
        endDrag();
      };
      chip.addEventListener('pointermove', onMove);
      chip.addEventListener('pointerup', onUp);
      chip.addEventListener('pointercancel', onUp);
    });
  });

  document.querySelectorAll('.rotateBtn').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const shipName = btn.dataset.rotate;
      trayOrientation[shipName] = (trayOrientation[shipName]==='v') ? 'h' : 'v';
      render();
    });
  });

  // Tap a placed ship's cells to send it back to the tray (simple, no reposition-drag —
  // keeps the interaction model small: repositioning is "clear, then drag again").
  document.querySelectorAll('#placeGrid .bscell').forEach(el=>{
    if(el.dataset.hasShip==='1'){
      el.addEventListener('click', ()=>{
        const r=+el.dataset.r, c=+el.dataset.c;
        const shipName = Object.keys(placement).find(n=>placement[n].cells.some(([pr,pc])=>pr===r&&pc===c));
        if(shipName) clearShip(shipName);
      });
    }
  });
}

function renderFireGrid(){
  const b = bs();
  const myTurn = S.turn===S.my_slot;
  let html = `<div style="${gridWrapStyle()}">`;
  for(let r=0;r<10;r++) for(let c=0;c<10;c++){
    const shot = b.my_shots.find(s=>s.r===r&&s.c===c);
    let content='', extra='background:#FCFAF5;';
    if(shot){
      if(shot.hit){ content='✕'; extra = shot.sunk ? 'background:var(--tomato-d);color:#fff;' : 'background:var(--tomato);color:#fff;'; }
      else { content='•'; extra='background:#EAE1D2;color:var(--muted);'; }
    } else if(myTurn){
      extra += 'cursor:pointer;';
    }
    html += `<div class="bscell" ${!shot&&myTurn?`data-fire-r="${r}" data-fire-c="${c}"`:''} style="${gridCellStyle(extra)}">${content}</div>`;
  }
  html += `</div>`;
  return html;
}
function renderFleetGrid(){
  const b = bs();
  const myShipCells = [];
  b.my_ships.forEach(s=>s.cells.forEach(([r,c])=>myShipCells.push([r,c,s.name])));
  let html = `<div style="${gridWrapStyle()}">`;
  for(let r=0;r<10;r++) for(let c=0;c<10;c++){
    const onShip = myShipCells.find(([sr,sc])=>sr===r&&sc===c);
    const incoming = b.incoming_shots.find(s=>s.r===r&&s.c===c);
    let content='', extra = onShip ? 'background:var(--ink);color:#fff;' : 'background:#FCFAF5;';
    if(incoming){
      if(incoming.hit){ content='✕'; extra = incoming.sunk ? 'background:var(--tomato-d);color:#fff;' : 'background:var(--tomato);color:#fff;'; }
      else { content='•'; extra='background:#EAE1D2;color:var(--muted);'; }
    }
    html += `<div class="bscell" style="${gridCellStyle(extra)}">${content}</div>`;
  }
  html += `</div>`;
  return html;
}
function viewPlay(){
  const myTurn = S.turn===S.my_slot;
  const b = bs();
  const mySunkCount = b.sunk_mine.length, theirSunkCount = b.sunk_theirs.length;

  const tabBar = `<div class="seg" id="boardTabs" style="margin-bottom:14px">
    <button data-btab="fire" aria-pressed="${boardTab==='fire'}">Enemy waters</button>
    <button data-btab="fleet" aria-pressed="${boardTab==='fleet'}">My fleet</button>
  </div>`;

  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="turn ${myTurn?'you':'them'}"><span class="dot"></span>${myTurn?'Your turn — fire at enemy waters':`${esc(opp()?.name||'Opponent')}'s turn`}</div>
  <div class="rosters" style="margin-bottom:12px">
    <div class="teambox mine"><h4>${esc(me()?.name||'You')}</h4><div style="font-family:'Space Mono',monospace;font-size:18px;font-weight:700">${5-mySunkCount}/5 ships afloat</div></div>
    <div class="teambox"><h4>${esc(opp()?.name||'Opponent')}</h4><div style="font-family:'Space Mono',monospace;font-size:18px;font-weight:700">${5-theirSunkCount}/5 ships afloat</div></div>
  </div>
  <div class="card">
    ${tabBar}
    ${boardTab==='fire' ? renderFireGrid() : renderFleetGrid()}
    <p class="msub" style="text-align:center;margin-top:10px">${boardTab==='fire' ? (myTurn?'Tap a cell to fire.':'Waiting for your opponent…') : 'Your ships, and the shots fired against them.'}</p>
  </div>
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">End game</button>`;
}

function viewDone(){
  const iWon = S.winner===S.my_slot;
  return `<div class="card"><div class="result">
      <span class="eyebrow" style="color:${iWon?'var(--green)':'var(--muted)'}">${iWon?'Victory!':'Game over'}</span>
      <h2>${iWon?'You sunk their fleet! 🎉':`${esc(opp()?.name||'Opponent')} wins`}</h2>
    </div>
    <button class="btn" id="againBtn">Play again</button>
  </div>
  <button class="linkbtn" id="backHome2" style="display:block;margin:12px auto 0">‹ Arcade menu</button>`;
}

function render(){
  chip.innerHTML = (S && code && S.status!=='finished') ? `<div class="codechip"><small>CODE</small>${esc(S.code)}</div>` : '';
  let html;
  if(!code || !S){ html=viewSetup(); }
  else if(S.status==='finished'){ html=viewDone(); }
  else if(S.status==='playing'){ html=viewPlay(); }
  else { html=viewPlacement(); }
  app.innerHTML = html;
  wire();
}
function wire(){
  const on=(id,ev,fn)=>{const el=document.getElementById(id); if(el) el.addEventListener(ev,fn);};
  on('backHome','click', ()=>exitToMenu());
  on('backHome2','click', ()=>exitToMenu());
  on('createBtn','click', ()=>{ const n=(document.getElementById('nameIn')?.value||'').trim(); if(n){name=n;localStorage.setItem('arc_name',n);} createGame(); });
  on('joinBtn','click', ()=>{ const n=(document.getElementById('nameIn')?.value||'').trim(); if(n){name=n;localStorage.setItem('arc_name',n);} joinGame(); });
  const ci=document.getElementById('codeIn'); if(ci) ci.addEventListener('keydown',e=>{if(e.key==='Enter')joinGame();});
  on('copyBtn','click', async()=>{ try{ await navigator.clipboard.writeText(S.code); const b=document.getElementById('copyBtn'); b.textContent='Copied ✓'; setTimeout(()=>b.textContent='Copy game code',1400); }catch(e){} });
  on('lockFleetBtn','click', lockFleet);
  document.querySelectorAll('.bscell[data-fire-r]').forEach(el=>el.addEventListener('click',()=>{
    fireAt(+el.dataset.fireR, +el.dataset.fireC);
  }));
  document.querySelectorAll('#boardTabs button').forEach(b=>b.addEventListener('click',()=>{boardTab=b.dataset.btab;render();}));
  initPlacementDrag();
  on('leaveBtn','click', leaveGame);
  on('againBtn','click', playAgain);
}

export async function initBattleship(containerEl, chipEl, onExit){
  app=containerEl; chip=chipEl; exitToMenu=onExit;
  code=''; S=null; err=''; lastSig=''; placement={}; trayOrientation={}; boardTab='fire'; drag=null;
  render();
}
export function teardownBattleship(){
  if(poll){ clearInterval(poll); poll=null; }
  if(drag){ drag.ghost.remove(); drag=null; }
}
