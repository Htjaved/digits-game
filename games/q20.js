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
let secretEntry='', questionEntry='', guessEntry='', actionTab='question'; // 'question' | 'guess'

const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function rpc(fn,args){const{data,error}=await sb.rpc(fn,args); if(error) throw new Error((error.message||'').replace(/^.*?:\s*/,'')||'error'); return data;}
const FR={GAME_NOT_FOUND:'No game with that code. Check it and try again.',GAME_FULL:'That game is already full.',
  NOT_YOUR_TURN:'Hold on — it’s not your turn yet.',NOT_PLAYING:'The game isn’t ready yet.',
  BAD_SECRET:'Type something for your secret (1–60 characters).',LOCKED:'The game already started.',
  NOT_A_PLAYER:'You’re not in this game anymore.',BAD_QUESTION:'Type a question first.',
  QUESTION_PENDING:'Answer the pending question first.',NO_PENDING_QUESTION:'There’s no question to answer.',
  BAD_ANSWER:'Pick yes, no, or maybe.',BAD_GUESS:'Type a guess first.'};
const fr=m=>FR[m]||m||'Something went wrong.';

function P(){ return S?.players||[]; }
function me(){ return P().find(p=>p.slot===S.my_slot); }
function opp(){ return P().find(p=>p.slot!==S.my_slot); }
function pendingQ(){ return S?.state?.pending_question || null; }

async function createGame(){
  err='';
  try{ code=await rpc('arc_create_game',{p_type:'q20',p_config:{},p_name:name,p_token:token}); await refresh(true); startPoll(); }
  catch(e){err=fr(e.message);render();}
}
async function joinGame(){
  err='';
  const cd=(document.getElementById('codeIn')?.value||'').trim().toUpperCase();
  if(cd.length<4){err='Enter the 4-letter game code.';return render();}
  try{ await rpc('arc_join_game',{p_code:cd,p_name:name,p_token:token}); code=cd; await refresh(true); startPoll(); }
  catch(e){err=fr(e.message);render();}
}
async function submitSecret(){
  err='';
  const s=secretEntry.trim();
  if(!s){err='Type something for your secret.';return render();}
  try{ await rpc('q20_set_secret',{p_code:code,p_token:token,p_secret:s}); secretEntry=''; await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function askQuestion(){
  err='';
  const q=questionEntry.trim();
  if(!q){err='Type a question first.';return render();}
  try{ await rpc('q20_ask',{p_code:code,p_token:token,p_question:q}); questionEntry=''; await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function answerQuestion(ans){
  err='';
  try{ await rpc('q20_answer',{p_code:code,p_token:token,p_answer:ans}); await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function makeGuess(){
  err='';
  const g=guessEntry.trim();
  if(!g){err='Type a guess first.';return render();}
  try{ await rpc('q20_guess',{p_code:code,p_token:token,p_guess:g}); guessEntry=''; await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
function leaveGame(){ if(poll){clearInterval(poll);poll=null;} code='';S=null;err='';lastSig=''; exitToMenu(); }
function playAgain(){ if(poll){clearInterval(poll);poll=null;} code='';S=null;err='';lastSig=''; render(); }

function startPoll(){ if(poll) clearInterval(poll); poll=setInterval(()=>refresh(false),1500); }
async function refresh(force){
  if(!code) return;
  try{
    const d=await rpc('arc_state',{p_code:code,p_token:token}); S=d;
    const sig=[S.status,S.turn,S.winner,(S.events||[]).length,(S.players||[]).length,JSON.stringify(S.state)].join('|');
    if(force||sig!==lastSig){lastSig=sig;render();}
    if(S.status==='finished'&&poll){clearInterval(poll);poll=null;}
  }catch(e){ if(/GAME_NOT_FOUND/.test(e.message)) leaveGame(); }
}

function viewSetup(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ Arcade menu</button>
  <div class="card">
    <p class="lede">Both of you secretly think of something. Take turns: ask a yes/no question about their secret, or take a free guess at it. First to guess right wins.</p>
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
function viewSecretEntry(){
  const haveSecret = !!me()?.has_secret;
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="card">
    <div class="bigcode">${esc(S.code)}</div>
    <button class="copybtn" id="copyBtn">Copy game code</button>
    <div class="rosters">
      <div class="teambox mine"><h4>You</h4><ul><li>${esc(me()?.name||'You')}</li></ul>
        <span class="secflag">${haveSecret?'✓ secret locked':''}</span></div>
      <div class="teambox"><h4>Opponent</h4><ul>${opp()?`<li>${esc(opp().name)}</li>`:'<li class="w">waiting…</li>'}</ul>
        <span class="secflag">${opp()?.has_secret?'✓ secret locked':''}</span></div>
    </div>
  </div>
  ${haveSecret ? `<div class="card"><p class="lede" style="margin:0">Your secret is locked in. Waiting on your opponent…</p></div>` : `
  <div class="card">
    <p class="lede">Think of a person, place, or thing — anything your opponent could ask yes/no questions about. Keep it specific enough to guess (e.g. "a golden retriever", not "an animal").</p>
    <input class="text" id="secretIn" maxlength="60" placeholder="e.g. The Eiffel Tower" autocomplete="off" />
    <div style="height:14px"></div>
    <button class="btn" id="lockSecretBtn">Lock in my secret</button>
  </div>`}
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">Leave game</button>`;
}
function viewPlay(){
  const myTurn = S.turn===S.my_slot;
  const pq = pendingQ();
  const amAnswering = pq && !myTurn;
  const events = S.events||[];
  const log = events.filter(e=>e.kind==='question'||e.kind==='answer'||e.kind==='guess_word');

  let actionBlock = '';
  if(amAnswering){
    actionBlock = `<div class="card">
      <p class="lede" style="margin-bottom:10px"><b>${esc(opp()?.name||'They')} asked:</b><br>"${esc(pq)}"</p>
      <div class="row" style="gap:8px">
        <button class="btn" id="ansYes" style="background:var(--green)">Yes</button>
        <button class="btn" id="ansNo" style="background:var(--tomato-d)">No</button>
        <button class="btn ghost" id="ansMaybe">Maybe</button>
      </div>
    </div>`;
  } else if(myTurn && pq){
    actionBlock = `<div class="card"><p class="lede" style="margin:0">Waiting for ${esc(opp()?.name||'them')} to answer your question…</p></div>`;
  } else if(myTurn){
    actionBlock = `<div class="card">
      <div class="seg" id="actionTabs" style="margin-bottom:14px">
        <button data-tab="question" aria-pressed="${actionTab==='question'}">Ask a question</button>
        <button data-tab="guess" aria-pressed="${actionTab==='guess'}">Guess it</button>
      </div>
      ${actionTab==='question' ? `
        <p class="lede" style="margin-bottom:8px">Ask a yes/no question about ${esc(opp()?.name||'their')} secret.</p>
        <input class="text" id="qIn" maxlength="200" placeholder="Is it bigger than a car?" autocomplete="off" />
        <div style="height:12px"></div>
        <button class="btn" id="askBtn">Ask</button>
      ` : `
        <p class="lede" style="margin-bottom:8px">Free guess — no penalty if you're wrong, but it still uses your turn.</p>
        <input class="text" id="gIn" maxlength="80" placeholder="Your guess…" autocomplete="off" />
        <div style="height:12px"></div>
        <button class="btn" id="guessBtn">Submit guess</button>
      `}
    </div>`;
  } else {
    actionBlock = `<div class="card"><p class="lede" style="margin:0">Waiting for ${esc(opp()?.name||'opponent')}'s turn…</p></div>`;
  }

  const logHtml = log.length ? log.slice().reverse().map(e=>{
    const isMe = e.slot===S.my_slot;
    const who = isMe ? 'You' : (opp()?.name||'Them');
    if(e.kind==='question') return `<div class="gline"><span class="gdigits" style="font-size:14px;font-family:Inter;font-weight:600">${esc(who)} asked: <span style="font-weight:400">${esc(e.payload.text)}</span></span></div>`;
    if(e.kind==='answer') return `<div class="gline"><span class="gdigits" style="font-size:14px;font-family:Inter;font-weight:600">${esc(who)} answered: <span class="pill ${e.payload.text==='yes'?'place':e.payload.text==='no'?'corr':''}" style="text-transform:capitalize">${esc(e.payload.text)}</span></span></div>`;
    if(e.kind==='guess_word') return `<div class="gline ${e.payload.correct?'winrow':''}"><span class="gdigits" style="font-size:14px;font-family:Inter;font-weight:600">${esc(who)} guessed: <span style="font-weight:400">${esc(e.payload.text)}</span> ${e.payload.correct?'✅':'❌'}</span></div>`;
    return '';
  }).join('') : '<div class="empty">No questions yet — break the ice!</div>';

  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="turn ${myTurn?'you':'them'}"><span class="dot"></span>${amAnswering?`${esc(opp()?.name||'They')} is waiting on your answer`:myTurn?`Your turn`:`${esc(opp()?.name||'Opponent')}'s turn`}</div>
  ${actionBlock}
  <div class="grow"></div>
  <div class="receipt"><div class="rhead"><span class="who">Game log</span><span class="cnt">${log.length}</span></div>${logHtml}</div>
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:12px auto 0">End game</button>`;
}
function viewDone(){
  const iWon = S.winner===S.my_slot;
  const rev = S.reveal||{};
  const oppSlot = S.my_slot===1?2:1;
  const mine = rev[String(S.my_slot)]||'—';
  const theirs = rev[String(oppSlot)]||'—';
  return `<div class="card"><div class="result">
      <span class="eyebrow" style="color:${iWon?'var(--green)':'var(--muted)'}">${iWon?'You win!':'Game over'}</span>
      <h2>${iWon?'You guessed it! 🎉':`${esc(opp()?.name||'Opponent')} wins`}</h2>
      <div class="reveal">
        <div><span class="lbl">Your secret</span><span class="num" style="font-size:16px;letter-spacing:0">${esc(mine)}</span></div>
        <div><span class="lbl">${esc(opp()?.name||'Theirs')}</span><span class="num" style="font-size:16px;letter-spacing:0">${esc(theirs)}</span></div>
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
  else { html=viewSecretEntry(); }
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
  on('lockSecretBtn','click', ()=>{ secretEntry=document.getElementById('secretIn')?.value||''; submitSecret(); });
  const si=document.getElementById('secretIn'); if(si) si.addEventListener('keydown',e=>{if(e.key==='Enter'){secretEntry=si.value;submitSecret();}});
  document.querySelectorAll('#actionTabs button').forEach(b=>b.addEventListener('click',()=>{actionTab=b.dataset.tab;render();}));
  on('askBtn','click', ()=>{ questionEntry=document.getElementById('qIn')?.value||''; askQuestion(); });
  const qi=document.getElementById('qIn'); if(qi) qi.addEventListener('keydown',e=>{if(e.key==='Enter'){questionEntry=qi.value;askQuestion();}});
  on('guessBtn','click', ()=>{ guessEntry=document.getElementById('gIn')?.value||''; makeGuess(); });
  const gi=document.getElementById('gIn'); if(gi) gi.addEventListener('keydown',e=>{if(e.key==='Enter'){guessEntry=gi.value;makeGuess();}});
  on('ansYes','click', ()=>answerQuestion('yes'));
  on('ansNo','click', ()=>answerQuestion('no'));
  on('ansMaybe','click', ()=>answerQuestion('maybe'));
  on('leaveBtn','click', leaveGame);
  on('againBtn','click', playAgain);
}

export async function initQ20(containerEl, chipEl, onExit){
  app=containerEl; chip=chipEl; exitToMenu=onExit;
  code=''; S=null; err=''; lastSig=''; secretEntry=''; questionEntry=''; guessEntry=''; actionTab='question';
  render();
}
export function teardownQ20(){
  if(poll){ clearInterval(poll); poll=null; }
}
