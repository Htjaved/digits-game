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
let placement={}; // name -> {cells:[[r,c],...]} once placed
let selectedShip='carrier', orientation='h';
let boardTab='fire'; // 'fire' | 'fleet' — which grid the play screen shows

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
function tryPlace(r,c){
  const ship = FLEET.find(f=>f.name===selectedShip);
  const cells = shipCells(ship.len, r, c, orientation);
  if(!cellsValid(cells, selectedShip)){ err='That placement is off the grid or overlaps another ship.'; render(); return; }
  placement[selectedShip] = {cells};
  err='';
  const next = FLEET.find(f=>!placement[f.name]);
  if(next) selectedShip = next.name;
  render();
}
function clearShip(shipName){ delete placement[shipName]; render(); }

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
function leaveGame(){ if(poll){clearInterval(poll);poll=null;} code='';S=null;err='';lastSig='';placement={};boardTab='fire'; exitToMenu(); }
function playAgain(){ if(poll){clearInterval(poll);poll=null;} code='';S=null;err='';lastSig='';placement={};boardTab='fire'; render(); }

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
  return `display:grid;grid-template-columns:repeat(10,1fr);gap:2px;background:var(--line);border-radius:10px;overflow:hidden;padding:2px;`;
}

function renderPlacementGrid(){
  const placedCells = allPlacedCells(null);
  let html = `<div style="${gridWrapStyle()}">`;
  for(let r=0;r<10;r++) for(let c=0;c<10;c++){
    const onShip = placedCells.some(([pr,pc])=>pr===r&&pc===c);
    html += `<div class="bscell" data-r="${r}" data-c="${c}" style="${gridCellStyle(onShip?'background:var(--ink);color:#fff;cursor:pointer':'background:#FCFAF5;cursor:pointer')}"></div>`;
  }
  html += `</div>`;
  return html;
}
function viewPlacement(){
  const allPlaced = FLEET.every(f=>placement[f.name]);
  const shipRows = FLEET.map(f=>{
    const done = !!placement[f.name];
    const active = selectedShip===f.name && !done;
    return `<button class="btn ${done?'ghost':active?'':'ghost'}" data-ship="${f.name}" style="margin-bottom:8px;${done?'opacity:.55':''}${active?'outline:2px solid var(--tomato)':''}">
      ${esc(f.label)} (${f.len}) ${done?'✓ placed — tap to clear':''}
    </button>`;
  }).join('');
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
    <p class="lede" style="margin-bottom:10px">Place all 5 ships. Pick a ship, choose an orientation, then tap the grid where it should start.</p>
    <div style="display:flex;flex-direction:column;gap:0">${shipRows}</div>
    <div class="seg" id="orientSeg" style="margin:10px 0 14px">
      <button data-o="h" aria-pressed="${orientation==='h'}">Horizontal</button>
      <button data-o="v" aria-pressed="${orientation==='v'}">Vertical</button>
    </div>
    ${renderPlacementGrid()}
    <div style="height:16px"></div>
    <button class="btn" id="lockFleetBtn" ${allPlaced?'':'disabled'}>Lock in my fleet</button>
  </div>`}
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">Leave game</button>`;
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
  document.querySelectorAll('[data-ship]').forEach(b=>b.addEventListener('click',()=>{
    const shipName=b.dataset.ship;
    if(placement[shipName]){ clearShip(shipName); } else { selectedShip=shipName; render(); }
  }));
  document.querySelectorAll('#orientSeg button').forEach(b=>b.addEventListener('click',()=>{orientation=b.dataset.o;render();}));
  document.querySelectorAll('.bscell[data-r]').forEach(el=>el.addEventListener('click',()=>{
    tryPlace(+el.dataset.r, +el.dataset.c);
  }));
  on('lockFleetBtn','click', lockFleet);
  document.querySelectorAll('.bscell[data-fire-r]').forEach(el=>el.addEventListener('click',()=>{
    fireAt(+el.dataset.fireR, +el.dataset.fireC);
  }));
  document.querySelectorAll('#boardTabs button').forEach(b=>b.addEventListener('click',()=>{boardTab=b.dataset.btab;render();}));
  on('leaveBtn','click', leaveGame);
  on('againBtn','click', playAgain);
}

export async function initBattleship(containerEl, chipEl, onExit){
  app=containerEl; chip=chipEl; exitToMenu=onExit;
  code=''; S=null; err=''; lastSig=''; placement={}; selectedShip='carrier'; orientation='h'; boardTab='fire';
  render();
}
export function teardownBattleship(){
  if(poll){ clearInterval(poll); poll=null; }
}
