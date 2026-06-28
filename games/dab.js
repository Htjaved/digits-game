import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SB_URL='https://iwwodozxqsgbaghndncs.supabase.co';
const SB_KEY='sb_publishable_dMtLijCoMrB4S7b6esp4oQ_ICgLZX0x';
const sb=createClient(SB_URL,SB_KEY);

function uid(){return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));}
let token=localStorage.getItem('arc_token'); if(!token){token=uid();localStorage.setItem('arc_token',token);}
let name=localStorage.getItem('arc_name')||'';
let code='';

let app, chip, exitToMenu;
let S=null, err='', poll=null, lastSig='';
let newSize=4;
let lastMoveFlash=null;

const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const PCOLORS={1:'#E2563B',2:'#3B6FE2'};

async function rpc(fn,args){const{data,error}=await sb.rpc(fn,args); if(error) throw new Error((error.message||'').replace(/^.*?:\s*/,'')||'error'); return data;}
const FR={GAME_NOT_FOUND:'No game with that code. Check it and try again.',GAME_FULL:'That game is already full.',
  NOT_YOUR_TURN:'Hold on — it’s not your turn yet.',NOT_PLAYING:'The game isn’t ready yet.',
  ALREADY_PLAYED:'That line is already drawn.',OUT_OF_RANGE:'That move is out of bounds.',
  NOT_A_PLAYER:'You’re not in this game anymore.',WAITING_FOR_PLAYER:'Waiting for your opponent to join.'};
const fr=m=>FR[m]||m||'Something went wrong.';

function P(){ return S?.players||[]; }
function me(){ return P().find(p=>p.slot===S.my_slot); }
function opp(){ return P().find(p=>p.slot!==S.my_slot); }
function W(){ return S?.config?.w||4; }
function H(){ return S?.config?.h||4; }

async function createGame(){
  err='';
  try{
    code=await rpc('arc_create_game',{p_type:'dab',p_config:{w:newSize,h:newSize},p_name:name,p_token:token});
    await refresh(true); startPoll();
  }catch(e){err=fr(e.message);render();}
}
async function joinGame(){
  err='';
  const cd=(document.getElementById('codeIn')?.value||'').trim().toUpperCase();
  if(cd.length<4){err='Enter the 4-letter game code.';return render();}
  try{ await rpc('arc_join_game',{p_code:cd,p_name:name,p_token:token}); code=cd; await refresh(true); startPoll(); }
  catch(e){err=fr(e.message);render();}
}
async function startGame(){
  err='';
  try{ await rpc('dab_start',{p_code:code,p_token:token}); await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function playLine(orient,row,col){
  err='';
  try{
    const r=await rpc('dab_play_line',{p_code:code,p_token:token,p_orient:orient,p_row:row,p_col:col});
    lastMoveFlash = r.boxes_completed>0 ? r : null;
    await refresh(true);
  }catch(e){err=fr(e.message);render();}
}
function leaveGame(){ if(poll){clearInterval(poll);poll=null;} code='';S=null;err='';lastSig=''; exitToMenu(); }
function playAgain(){ if(poll){clearInterval(poll);poll=null;} code='';S=null;err='';lastSig=''; render(); }

function startPoll(){ if(poll) clearInterval(poll); poll=setInterval(()=>refresh(false),1500); }
async function refresh(force){
  if(!code) return;
  try{
    const d=await rpc('arc_state',{p_code:code,p_token:token}); S=d;
    const sig=[S.status,S.turn,S.winner,JSON.stringify(S.state)].join('|');
    if(force||sig!==lastSig){lastSig=sig;render();}
    if(S.status==='finished'&&poll){clearInterval(poll);poll=null;}
  }catch(e){ if(/GAME_NOT_FOUND/.test(e.message)) leaveGame(); }
}

function viewSetup(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ Arcade menu</button>
  <div class="card">
    <p class="lede">Take turns drawing one line between two dots. Complete a box and it's yours — plus you get to go again. Most boxes when the grid fills up wins.</p>
    <label class="fld" for="nameIn">Your name</label>
    <input class="text" id="nameIn" maxlength="16" placeholder="e.g. ${esc(name||'You')}" value="${esc(name)}" />
    <div style="height:16px"></div>
    <label class="fld">Grid size</label>
    <div class="seg" id="segSize">
      <button data-s="3" aria-pressed="${newSize===3}">3×3</button>
      <button data-s="4" aria-pressed="${newSize===4}">4×4</button>
      <button data-s="5" aria-pressed="${newSize===5}">5×5</button>
      <button data-s="6" aria-pressed="${newSize===6}">6×6</button>
    </div>
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
function viewLobby(){
  const full = P().length>=2;
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="card">
    <div class="bigcode">${esc(S.code)}</div>
    <button class="copybtn" id="copyBtn">Copy game code</button>
    <div class="rosters">
      <div class="teambox mine"><h4>You</h4><ul><li>${esc(me()?.name||'You')}</li></ul></div>
      <div class="teambox"><h4>Opponent</h4><ul>${opp()?`<li>${esc(opp().name)}</li>`:'<li class="w">waiting…</li>'}</ul></div>
    </div>
    <p class="lede" style="margin:14px 0 0">Grid: ${W()}×${H()} boxes</p>
  </div>
  <div class="card">
    ${full ? `<button class="btn" id="startBtn">Start game</button>` : `<p class="lede" style="margin:0">Share the code above — waiting for a second player to join.</p>`}
  </div>
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">Leave game</button>`;
}

function renderBoard(){
  const w=W(), h=H();
  const st=S.state||{};
  const hLines=st.h_lines||[], vLines=st.v_lines||[], boxes=st.boxes||[];
  const cell=44, dotR=4, pad=18;
  const svgW = pad*2 + w*cell, svgH = pad*2 + h*cell;
  const myTurn = S.turn===S.my_slot;

  let svg = `<svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%;height:auto;display:block" xmlns="http://www.w3.org/2000/svg">`;

  for(let r=0;r<h;r++) for(let c=0;c<w;c++){
    const owner = boxes[r]?.[c]||0;
    if(owner){
      const x=pad+c*cell, y=pad+r*cell;
      svg += `<rect x="${x+3}" y="${y+3}" width="${cell-6}" height="${cell-6}" rx="6" fill="${PCOLORS[owner]}" opacity="0.16"/>`;
    }
  }
  for(let r=0;r<=h;r++) for(let c=0;c<w;c++){
    const drawn = hLines[r]?.[c];
    const x=pad+c*cell, y=pad+r*cell;
    const clickable = !drawn && myTurn;
    svg += `<line x1="${x}" y1="${y}" x2="${x+cell}" y2="${y}" stroke="${drawn?'#211C17':'#EAE1D2'}" stroke-width="${drawn?5:3}" stroke-linecap="round"
      ${clickable?`class="dabline" data-orient="h" data-row="${r}" data-col="${c}" style="cursor:pointer"`:''}/>`;
    if(clickable) svg += `<rect x="${x}" y="${y-9}" width="${cell}" height="18" fill="transparent" class="dabline" data-orient="h" data-row="${r}" data-col="${c}" style="cursor:pointer"/>`;
  }
  for(let r=0;r<h;r++) for(let c=0;c<=w;c++){
    const drawn = vLines[r]?.[c];
    const x=pad+c*cell, y=pad+r*cell;
    const clickable = !drawn && myTurn;
    svg += `<line x1="${x}" y1="${y}" x2="${x}" y2="${y+cell}" stroke="${drawn?'#211C17':'#EAE1D2'}" stroke-width="${drawn?5:3}" stroke-linecap="round"
      ${clickable?`class="dabline" data-orient="v" data-row="${r}" data-col="${c}" style="cursor:pointer"`:''}/>`;
    if(clickable) svg += `<rect x="${x-9}" y="${y}" width="18" height="${cell}" fill="transparent" class="dabline" data-orient="v" data-row="${r}" data-col="${c}" style="cursor:pointer"/>`;
  }
  for(let r=0;r<=h;r++) for(let c=0;c<=w;c++){
    const x=pad+c*cell, y=pad+r*cell;
    svg += `<circle cx="${x}" cy="${y}" r="${dotR}" fill="#211C17"/>`;
  }
  svg += `</svg>`;
  return svg;
}

function viewPlay(){
  const myTurn = S.turn===S.my_slot;
  const score = (S.state||{}).score || {1:0,2:0};
  const myScore = score[String(S.my_slot)] ?? score[S.my_slot] ?? 0;
  const oppSlot = S.my_slot===1?2:1;
  const oppScore = score[String(oppSlot)] ?? score[oppSlot] ?? 0;
  const flash = lastMoveFlash ? `<div class="card" style="padding:10px 16px;text-align:center;margin-bottom:12px">
      <span class="pill place">+${lastMoveFlash.boxes_completed} box${lastMoveFlash.boxes_completed>1?'es':''}${lastMoveFlash.extra_turn?' · go again!':''}</span>
    </div>` : '';
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="turn ${myTurn?'you':'them'}"><span class="dot"></span>${myTurn?'Your turn — draw a line':`${esc(opp()?.name||'Opponent')}'s turn`}</div>
  <div class="rosters" style="margin-bottom:12px">
    <div class="teambox mine"><h4>${esc(me()?.name||'You')}</h4><div style="font-family:'Space Mono',monospace;font-size:22px;font-weight:700;color:${PCOLORS[S.my_slot]}">${myScore}</div></div>
    <div class="teambox"><h4>${esc(opp()?.name||'Opponent')}</h4><div style="font-family:'Space Mono',monospace;font-size:22px;font-weight:700;color:${PCOLORS[oppSlot]}">${oppScore}</div></div>
  </div>
  ${flash}
  <div class="card" style="padding:14px">${renderBoard()}</div>
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">End game</button>`;
}
function viewDone(){
  const iWon = S.winner===S.my_slot;
  const draw = S.winner===0;
  const score = (S.state||{}).score || {};
  const oppSlot = S.my_slot===1?2:1;
  const myScore = score[String(S.my_slot)] ?? 0;
  const oppScore = score[String(oppSlot)] ?? 0;
  return `<div class="card"><div class="result">
      <span class="eyebrow" style="color:${draw?'var(--muted)':iWon?'var(--green)':'var(--muted)'}">${draw?'Draw':iWon?'You win!':'Game over'}</span>
      <h2>${draw?"It's a tie! 🤝":iWon?'You win! 🎉':`${esc(opp()?.name||'Opponent')} wins`}</h2>
      <div class="reveal">
        <div><span class="lbl">You</span><span class="num">${myScore}</span></div>
        <div><span class="lbl">${esc(opp()?.name||'Them')}</span><span class="num">${oppScore}</span></div>
      </div></div>
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
  else { html=viewLobby(); }
  app.innerHTML = html;
  wire();
}
function wire(){
  const on=(id,ev,fn)=>{const el=document.getElementById(id); if(el) el.addEventListener(ev,fn);};
  on('backHome','click', ()=>exitToMenu());
  on('backHome2','click', ()=>exitToMenu());
  document.querySelectorAll('#segSize button').forEach(b=>b.addEventListener('click',()=>{newSize=+b.dataset.s;render();}));
  on('createBtn','click', ()=>{ const n=(document.getElementById('nameIn')?.value||'').trim(); if(n){name=n;localStorage.setItem('arc_name',n);} createGame(); });
  on('joinBtn','click', ()=>{ const n=(document.getElementById('nameIn')?.value||'').trim(); if(n){name=n;localStorage.setItem('arc_name',n);} joinGame(); });
  const ci=document.getElementById('codeIn'); if(ci) ci.addEventListener('keydown',e=>{if(e.key==='Enter')joinGame();});
  on('copyBtn','click', async()=>{ try{ await navigator.clipboard.writeText(S.code); const b=document.getElementById('copyBtn'); b.textContent='Copied ✓'; setTimeout(()=>b.textContent='Copy game code',1400); }catch(e){} });
  on('startBtn','click', startGame);
  document.querySelectorAll('.dabline').forEach(el=>el.addEventListener('click',()=>{
    lastMoveFlash=null;
    playLine(el.dataset.orient, +el.dataset.row, +el.dataset.col);
  }));
  on('leaveBtn','click', leaveGame);
  on('againBtn','click', playAgain);
}

export async function initDab(containerEl, chipEl, onExit){
  app=containerEl; chip=chipEl; exitToMenu=onExit;
  code=''; S=null; err=''; lastSig=''; lastMoveFlash=null; newSize=4;
  render();
}
export function teardownDab(){
  if(poll){ clearInterval(poll); poll=null; }
}
