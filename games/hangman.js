import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SB_URL='https://iwwodozxqsgbaghndncs.supabase.co';
const SB_KEY='sb_publishable_dMtLijCoMrB4S7b6esp4oQ_ICgLZX0x';
const sb=createClient(SB_URL,SB_KEY);

function uid(){return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));}
let token=localStorage.getItem('arc_token'); if(!token){token=uid();localStorage.setItem('arc_token',token);}
let name=localStorage.getItem('arc_name')||'';
let code='';

let app, chip, exitToMenu;
let S=null, err='', poll=null, lastSig='', screen='setup'; // setup | lobby (S exists) handled via S.status
let wordEntry='';

const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ALPHA='abcdefghijklmnopqrstuvwxyz'.split('');

async function rpc(fn,args){const{data,error}=await sb.rpc(fn,args); if(error) throw new Error((error.message||'').replace(/^.*?:\s*/,'')||'error'); return data;}
const FR={GAME_NOT_FOUND:'No game with that code. Check it and try again.',GAME_FULL:'That game is already full.',
  NOT_YOUR_TURN:'Hold on — it’s not your turn yet.',NOT_PLAYING:'The game isn’t ready yet.',
  BAD_WORD:'Use letters only (2–20 of them).',LOCKED:'The game already started.',NOT_A_PLAYER:'You’re not in this game anymore.',
  BAD_LETTER:'Pick a single letter.',ALREADY_GUESSED:'You already tried that letter.'};
const fr=m=>FR[m]||m||'Something went wrong.';

function P(){ return S?.players||[]; }
function me(){ return P().find(p=>p.slot===S.my_slot); }
function opp(){ return P().find(p=>p.slot!==S.my_slot); }
function oppSlot(){ return S.my_slot===1?2:1; }

async function createGame(){
  err='';
  try{
    code=await rpc('arc_create_game',{p_type:'hangman',p_config:{lives:6},p_name:name,p_token:token});
    await refresh(true); startPoll();
  }catch(e){err=fr(e.message);render();}
}
async function joinGame(){
  err='';
  const cd=(document.getElementById('codeIn')?.value||'').trim().toUpperCase();
  if(cd.length<4){err='Enter the 4-letter game code.';return render();}
  try{
    await rpc('arc_join_game',{p_code:cd,p_name:name,p_token:token});
    code=cd; await refresh(true); startPoll();
  }catch(e){err=fr(e.message);render();}
}
async function submitWord(){
  err='';
  const w=wordEntry.trim();
  if(!/^[a-zA-Z]{2,20}$/.test(w)){err='Use letters only (2–20 of them).';return render();}
  try{ await rpc('hm_set_word',{p_code:code,p_token:token,p_word:w}); wordEntry=''; await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function guessLetter(letter){
  err='';
  try{ await rpc('hm_guess_letter',{p_code:code,p_token:token,p_letter:letter}); await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
function leaveGame(){
  if(poll){clearInterval(poll);poll=null;}
  code='';S=null;err='';lastSig='';wordEntry='';
  exitToMenu();
}
function playAgain(){ if(poll){clearInterval(poll);poll=null;} code='';S=null;err='';lastSig='';wordEntry=''; render(); }

function startPoll(){ if(poll) clearInterval(poll); poll=setInterval(()=>refresh(false),1500); }
async function refresh(force){
  if(!code) return;
  try{
    const d=await rpc('arc_state',{p_code:code,p_token:token}); S=d;
    const sig=[S.status,S.turn,S.winner,(S.events||[]).length,(S.players||[]).length].join('|');
    if(force||sig!==lastSig){lastSig=sig;render();}
    if(S.status==='finished'&&poll){clearInterval(poll);poll=null;}
  }catch(e){ if(/GAME_NOT_FOUND/.test(e.message)) leaveGame(); }
}

function maskedWord(secretLen, guessedByMe, opponentWordRevealLetters){
  // We never see the opponent's actual secret unless finished; we only know which of OUR guessed
  // letters were hits, derived from events. Build mask using event history against opp slot.
  return null; // not used directly; see renderMask()
}

function lettersGuessedAgainst(oppSlotNum){
  // returns set of letters I (my_slot) have guessed against opponent, derived from my own guessed_letters list
  const mePlayer = P().find(p=>p.slot===S.my_slot);
  return mePlayer?.my_guessed_letters || [];
}
function hitLettersFromEvents(slot){
  // letters that 'slot' guessed which were hits (against the OTHER player's word)
  return (S.events||[]).filter(e=>e.kind==='guess_letter' && e.slot===slot && e.payload.hit).map(e=>e.payload.letter);
}
function missLettersFromEvents(slot){
  return (S.events||[]).filter(e=>e.kind==='guess_letter' && e.slot===slot && !e.payload.hit).map(e=>e.payload.letter);
}
function wordLengthOf(slot){
  // length isn't directly exposed pre-finish; infer from config? We don't store per-secret length separately.
  // Simplify: show progressive reveal as "letters found so far" rather than blanks-with-fixed-length,
  // since length isn't leaked by the backend (by design) until finish.
  return null;
}

function renderProgress(oppSlotNum){
  const hits = hitLettersFromEvents(S.my_slot).filter(l=>true);
  // To show blanks correctly we DO need word length. Since backend intentionally doesn't leak it pre-reveal,
  // show a running list of confirmed letters instead of blank slots. This keeps the secret length hidden too,
  // which is actually a nice extra layer of mystery consistent with not leaking the secret.
  const hitSet=[...new Set(hitLettersFromEvents(S.my_slot))];
  if(!hitSet.length) return `<span class="msub">No letters found yet</span>`;
  return `<span class="gdigits" style="font-size:22px">${hitSet.join(' ').toUpperCase()}</span>`;
}

function keyboardGrid(disabledLetters, onClickEnabled){
  return `<div class="kbgrid">${ALPHA.map(l=>{
    const used=disabledLetters.includes(l);
    return `<button class="kbkey" data-letter="${l}" ${used?'disabled':''}>${l.toUpperCase()}</button>`;
  }).join('')}</div>`;
}

function viewSetup(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ Arcade menu</button>
  <div class="card">
    <p class="lede">Both players secretly pick a word. Take turns guessing one letter at a time against each other's word — each of you has your own 6 lives. Run out, and you lose.</p>
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
function viewWordEntry(){
  const haveWord = !!me()?.has_secret;
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="card">
    <div class="bigcode">${esc(S.code)}</div>
    <button class="copybtn" id="copyBtn">Copy game code</button>
    <div class="rosters">
      <div class="teambox mine"><h4>You</h4><ul><li>${esc(me()?.name||'You')}</li></ul>
        <span class="secflag">${haveWord?'✓ word locked':''}</span></div>
      <div class="teambox"><h4>Opponent</h4><ul>${opp()?`<li>${esc(opp().name)}</li>`:'<li class="w">waiting…</li>'}</ul>
        <span class="secflag">${opp()?.has_secret?'✓ word locked':''}</span></div>
    </div>
  </div>
  ${haveWord ? `<div class="card"><p class="lede" style="margin:0">Your word is locked in. Waiting on your opponent…</p></div>` : `
  <div class="card">
    <p class="lede">Pick a secret word (letters only, 2–20 characters). Your opponent won't see it — they'll guess it one letter at a time.</p>
    <input class="text" id="wordIn" maxlength="20" placeholder="e.g. elephant" autocapitalize="none" autocomplete="off" />
    <div style="height:14px"></div>
    <button class="btn" id="lockWordBtn">Lock in my word</button>
  </div>`}
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">Leave game</button>`;
}
function viewPlay(){
  const myTurn=S.turn===S.my_slot;
  const myLives = me()?.lives ?? 6;
  const oppLives = opp()?.lives ?? 6;
  const myGuessed = me()?.my_guessed_letters || [];
  const myMisses = missLettersFromEvents(S.my_slot);
  const myHits = hitLettersFromEvents(S.my_slot);
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="turn ${myTurn?'you':'them'}"><span class="dot"></span>${myTurn?`Your turn — guess a letter in ${esc(opp()?.name||'their')} word`:`Waiting for ${esc(opp()?.name||'opponent')}…`}</div>
  <div class="rosters" style="margin-bottom:14px">
    <div class="teambox mine"><h4>You</h4><div class="lives">${'❤️'.repeat(Math.max(myLives,0))}${'🖤'.repeat(Math.max(6-myLives,0))}</div></div>
    <div class="teambox"><h4>${esc(opp()?.name||'Opponent')}</h4><div class="lives">${'❤️'.repeat(Math.max(oppLives,0))}${'🖤'.repeat(Math.max(6-oppLives,0))}</div></div>
  </div>
  <div class="card">
    <p class="lede" style="margin-bottom:8px">Letters found in their word so far:</p>
    ${renderProgress()}
    <div style="height:16px"></div>
    ${keyboardGrid(myGuessed)}
  </div>
  <div class="grow"></div>
  <div class="receipt"><div class="rhead"><span class="who">Your guesses</span><span class="cnt">${myGuessed.length}</span></div>
    ${myGuessed.length? myGuessed.map(l=>`<span class="pill ${myHits.includes(l)?'place':'corr'}" style="margin:3px">${l.toUpperCase()}</span>`).join('') : '<div class="empty">No guesses yet.</div>'}
  </div>
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:12px auto 0">End game</button>`;
}
function viewDone(){
  const iWon = S.winner===S.my_slot;
  const rev = S.reveal||{};
  const mine = rev[String(S.my_slot)]||'—';
  const theirs = rev[String(oppSlot())]||'—';
  return `<div class="card"><div class="result">
      <span class="eyebrow" style="color:${iWon?'var(--green)':'var(--muted)'}">${iWon?'You win!':'Game over'}</span>
      <h2>${iWon?'You win! 🎉':`${esc(opp()?.name||'Opponent')} wins`}</h2>
      <div class="reveal">
        <div><span class="lbl">Your word</span><span class="num" style="font-size:18px;letter-spacing:.05em">${esc(mine)}</span></div>
        <div><span class="lbl">${esc(opp()?.name||'Theirs')}</span><span class="num" style="font-size:18px;letter-spacing:.05em">${esc(theirs)}</span></div>
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
  else { html=viewWordEntry(); }
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
  on('lockWordBtn','click', ()=>{ wordEntry=document.getElementById('wordIn')?.value||''; submitWord(); });
  const wi=document.getElementById('wordIn'); if(wi) wi.addEventListener('keydown',e=>{if(e.key==='Enter'){wordEntry=wi.value;submitWord();}});
  document.querySelectorAll('.kbkey').forEach(k=>k.addEventListener('click',()=>{ if(!k.disabled) guessLetter(k.dataset.letter); }));
  on('leaveBtn','click', leaveGame);
  on('againBtn','click', playAgain);
}

export async function initHangman(containerEl, chipEl, onExit){
  app=containerEl; chip=chipEl; exitToMenu=onExit;
  code=''; S=null; err=''; lastSig=''; wordEntry='';
  render();
}
export function teardownHangman(){
  if(poll){ clearInterval(poll); poll=null; }
}
