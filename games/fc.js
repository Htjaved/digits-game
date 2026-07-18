import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SB_URL='https://iwwodozxqsgbaghndncs.supabase.co';
const SB_KEY='sb_publishable_dMtLijCoMrB4S7b6esp4oQ_ICgLZX0x';
const sb=createClient(SB_URL,SB_KEY);

function uid(){return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));}
let token=localStorage.getItem('arc_token'); if(!token){token=uid();localStorage.setItem('arc_token',token);}
let name=localStorage.getItem('arc_name')||'';
let code='';

// ---- 50 broad, generative categories: deliberately wide (Nouns, Things inside a house, etc.)
// rather than narrow enumerable sets, so a determined guesser genuinely can't exhaust the
// possibility space — that was the whole point of the redesign. Split 25/25 (deterministic
// per game code) so neither player's 10-option dropdown can reveal what the other might pick.
const CATEGORIES=[
  'Nouns','Verbs','Adjectives','Words starting with S','Words starting with B','Words with double letters','Compound words',
  'Things inside a house','Things inside an office','Things inside a kitchen','Things inside a bathroom','Things found in nature','Things found in a city','Things found at a beach','Things found in a school','Things found in a hospital','Things you\u2019d pack for a trip',
  'Professions','Types of doctors','Fictional characters','Superheroes',
  'Things that are round','Things that are red','Things made of metal','Things made of wood','Things that can be broken','Things with wheels','Things you wear','Things you plug in','Things you can eat','Things you drink','Things in a toolbox','Things in a backpack',
  'Things you do in the morning','Things you do before bed','Sports','Hobbies','Emotions',
  'Animals','Animals that fly','Animals that live in water','Plants',
  'Movies','TV shows','Songs','Video games','Books',
  'Things that make noise','Modes of transportation','Things you can hold in one hand'
];

// Deterministic PRNG (mulberry32) seeded from the game code, so both devices compute the
// exact same shuffle/split independently — no backend round-trip needed for this.
function seedFromCode(c){ let h=0; for(let i=0;i<c.length;i++){ h=(h*31 + c.charCodeAt(i))>>>0; } return h; }
function mulberry32(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seededShuffle(arr, seed){
  const rand = mulberry32(seed), a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rand()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
// Returns the 10 preset options this player's dropdown should show: the game code seeds a
// shuffle of all 50, split into non-overlapping halves of 25 (slot 1 gets the first half,
// slot 2 the second), then each player sees the first 10 of their own half.
function categoryPool(gameCode, slot){
  if(!gameCode || !slot) return [];
  const shuffled = seededShuffle(CATEGORIES, seedFromCode(gameCode));
  const half = slot===1 ? shuffled.slice(0,25) : shuffled.slice(25,50);
  return half.slice(0,10);
}

let app, chip, exitToMenu;
let S=null, err='', poll=null, lastSig='';
let categoryMode='preset', categorySelect='', categoryCustom='';
let actionTab='word'; // 'word' | 'guess'
let wordEntry='', guessEntry='';

const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function rpc(fn,args){const{data,error}=await sb.rpc(fn,args); if(error) throw new Error((error.message||'').replace(/^.*?:\s*/,'')||'error'); return data;}
const FR={GAME_NOT_FOUND:'No game with that code. Check it and try again.',GAME_FULL:'That game is already full.',
  NOT_YOUR_TURN:'Hold on — it’s not your turn yet.',NOT_PLAYING:'The game isn’t ready yet.',
  BAD_CATEGORY:'Pick or type a category first (1–60 characters).',LOCKED:'The game already started — categories are locked.',
  NOT_A_PLAYER:'You’re not in this game anymore.',BAD_WORD:'Type a word first.',
  NO_PENDING_WORD:'That word isn’t waiting on a judgment.',ALREADY_REPLIED:'You already judged that.',
  BAD_REPLY:'Keep the reply under 200 characters.',NEED_3_ANSWERED:'Submit 3 words and get answers before you can guess the category.',
  BAD_VERDICT:'Something went wrong with that judgment — try again.',
  BAD_GUESS:'Type a guess first.',NO_PENDING_GUESS:'That guess isn’t waiting on a judgment.'};
const fr=m=>FR[m]||m||'Something went wrong.';

function P(){ return S?.players||[]; }
function me(){ return P().find(p=>p.slot===S.my_slot); }
function opp(){ return P().find(p=>p.slot!==S.my_slot); }
function oppSlot(){ return S.my_slot===1?2:1; }
function answeredCount(slot){ return Number(S?.state?.answered_count?.[String(slot)] ?? 0); }
// The single pending action (a submitted word or a category guess) awaiting judgment — turn=0
// is the backend's signal that something is parked in limbo, mirroring q20's guess flow.
function pendingEvent(){
  if(!S || S.turn!==0) return null;
  const events = S.events||[];
  return events.slice().reverse().find(e => (e.kind==='word'||e.kind==='guess_category') && !e.payload.replied) || null;
}
// Words submitted BY `slot` (into the OTHER player's category), grouped by judged verdict —
// 'yes'/'no'/'could_be'/'close'.
function wordsByVerdict(slot, verdict){ return (S.events||[]).filter(e=>e.kind==='word' && e.slot===slot && e.payload.replied && e.payload.verdict===verdict); }
function categoryGuesses(){ return (S.events||[]).filter(e=>e.kind==='guess_category' && e.payload.replied); }

async function createGame(){
  err='';
  try{ code=await rpc('arc_create_game',{p_type:'fc',p_config:{},p_name:name,p_token:token}); await refresh(true); startPoll(); }
  catch(e){err=fr(e.message);render();}
}
async function joinGame(){
  err='';
  const cd=(document.getElementById('codeIn')?.value||'').trim().toUpperCase();
  if(cd.length<4){err='Enter the 4-letter game code.';return render();}
  try{ await rpc('arc_join_game',{p_code:cd,p_name:name,p_token:token}); code=cd; await refresh(true); startPoll(); }
  catch(e){err=fr(e.message);render();}
}
async function submitCategory(){
  err='';
  const cat = (categoryMode==='preset' ? categorySelect : categoryCustom).trim();
  if(!cat){err='Pick or type a category first.';return render();}
  try{ await rpc('fc_set_category',{p_code:code,p_token:token,p_category:cat}); await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function submitWord(){
  err='';
  const w=wordEntry.trim();
  if(!w){err='Type a word first.';return render();}
  try{ await rpc('fc_submit_word',{p_code:code,p_token:token,p_word:w}); wordEntry=''; await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function submitGuess(){
  err='';
  const g=guessEntry.trim();
  if(!g){err='Type a guess first.';return render();}
  try{ await rpc('fc_guess_category',{p_code:code,p_token:token,p_guess:g}); guessEntry=''; await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function judgeWord(eventId, verdict){
  err='';
  try{ await rpc('fc_reply_word',{p_code:code,p_token:token,p_event_id:eventId,p_verdict:verdict}); await refresh(true); }
  catch(e){err=fr(e.message);render();}
}
async function judgeGuess(eventId, correct){
  err='';
  try{ await rpc('fc_reply_guess',{p_code:code,p_token:token,p_event_id:eventId,p_correct:correct,p_reply:null}); await refresh(true); }
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
    <p class="lede">Both of you secretly pick a category. Take turns: submit a word that fits your opponent's category (they'll judge if it counts), or once you've got 3 words approved, guess their category outright. First correct guess wins.</p>
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
function viewCategoryEntry(){
  const haveCategory = !!me()?.has_secret;
  const pool = categoryPool(S.code, S.my_slot);
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="card">
    <div class="bigcode">${esc(S.code)}</div>
    <button class="copybtn" id="copyBtn">Copy game code</button>
    <div class="rosters">
      <div class="teambox mine"><h4>You</h4><ul><li>${esc(me()?.name||'You')}</li></ul>
        <span class="secflag">${haveCategory?'✓ category locked':''}</span></div>
      <div class="teambox"><h4>Opponent</h4><ul>${opp()?`<li>${esc(opp().name)}</li>`:'<li class="w">waiting…</li>'}</ul>
        <span class="secflag">${opp()?.has_secret?'✓ category locked':''}</span></div>
    </div>
  </div>
  ${haveCategory ? `<div class="card">
    <p class="lede" style="margin:0 0 4px">Your category:</p>
    <p style="margin:0;font-size:19px;font-weight:700">${esc(S.my_secret||'')}</p>
    <p class="lede" style="margin:10px 0 0">Locked in. Waiting on your opponent…</p>
  </div>` : `
  <div class="card">
    <p class="lede">Pick a category — your opponent will try to submit words that fit it, or guess it outright.</p>
    <div class="seg" id="catMode">
      <button data-mode="preset" aria-pressed="${categoryMode==='preset'}">Pick one</button>
      <button data-mode="custom" aria-pressed="${categoryMode==='custom'}">Write my own</button>
    </div>
    <div style="height:14px"></div>
    ${categoryMode==='preset' ? `
      <label class="fld" for="catSelect">Category</label>
      <select id="catSelect" class="text">
        <option value="">Choose one…</option>
        ${pool.map(c=>`<option value="${esc(c)}" ${categorySelect===c?'selected':''}>${esc(c)}</option>`).join('')}
      </select>
    ` : `
      <label class="fld" for="catCustom">Your category</label>
      <input class="text" id="catCustom" maxlength="60" placeholder="e.g. Types of clouds" autocomplete="off" value="${esc(categoryCustom)}" />
    `}
    <div style="height:14px"></div>
    <button class="btn" id="lockCatBtn">Lock in my category</button>
  </div>`}
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">Leave game</button>`;
}
function viewPlay(){
  const myTurn = S.turn===S.my_slot;
  const pend = pendingEvent();
  const iAmJudge = pend && pend.slot !== S.my_slot;
  const waitingOnJudge = pend && pend.slot === S.my_slot;
  const myAnswered = answeredCount(S.my_slot);
  const canGuess = myAnswered >= 3;

  let actionBlock = '';
  if(pend && iAmJudge){
    const isWord = pend.kind==='word';
    actionBlock = `<div class="card">
      <p class="lede" style="margin-bottom:10px"><b>${esc(opp()?.name||'They')}</b> ${isWord?'submitted a word for your category':'guessed your category'}:<br>"${esc(pend.payload.text)}"</p>
      <p class="lede" style="margin-bottom:10px">${isWord?'Does it fit your category?':'Did they get it exactly right?'}</p>
      ${isWord ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn" id="judgeYes" style="background:var(--green)">Yes</button>
        <button class="btn ghost" id="judgeNo">No</button>
        <button class="btn ghost" id="judgeCouldBe">Could be</button>
        <button class="btn ghost" id="judgeClose">Close</button>
      </div>` : `
      <div class="row" style="gap:8px">
        <button class="btn" id="judgeYes" style="background:var(--green)">Correct</button>
        <button class="btn ghost" id="judgeNo">Not quite</button>
      </div>`}
    </div>`;
  } else if(pend && waitingOnJudge){
    actionBlock = `<div class="card"><p class="lede" style="margin:0">Waiting for ${esc(opp()?.name||'them')} to judge…</p></div>`;
  } else if(myTurn){
    actionBlock = `<div class="card">
      <div class="seg" id="actionTabs" style="margin-bottom:14px">
        <button data-tab="word" aria-pressed="${actionTab==='word'}">Submit a word</button>
        <button data-tab="guess" aria-pressed="${actionTab==='guess'}">Guess their category</button>
      </div>
      ${actionTab==='word' ? `
        <p class="lede" style="margin-bottom:8px">Submit a word for ${esc(opp()?.name||'their')} category — they'll judge if it fits.</p>
        <input class="text" id="wIn" maxlength="60" placeholder="Your word…" autocomplete="off" />
        <div style="height:12px"></div>
        <button class="btn" id="wordBtn">Submit</button>
      ` : canGuess ? `
        <p class="lede" style="margin-bottom:4px">Guess ${esc(opp()?.name||'their')} category outright. Get it right and you win instantly.</p>
        <p style="margin:0 0 10px;font-size:12px;color:var(--muted);font-weight:600">You've answered ${myAnswered}/3 words — guessing unlocked</p>
        <input class="text" id="gIn" maxlength="60" placeholder="Your guess…" autocomplete="off" />
        <div style="height:12px"></div>
        <button class="btn" id="catGuessBtn">Submit guess</button>
      ` : `
        <p class="lede" style="margin:0">Submit at least 3 words before you can guess. You've submitted and gotten answers on ${myAnswered}/3 so far.</p>
      `}
    </div>`;
  } else {
    actionBlock = `<div class="card"><p class="lede" style="margin:0">Waiting for ${esc(opp()?.name||'opponent')}'s turn…</p></div>`;
  }

  // Fits their category = words I submitted into THEIR category, grouped by verdict.
  // Fits your category = words they submitted into MY category, grouped by verdict.
  const guesses = categoryGuesses();
  const VERDICTS = [
    {key:'yes', label:'Yes', bg:'var(--green-bg)', fg:'var(--green)'},
    {key:'no', label:'No', bg:'#F2ECDF', fg:'var(--muted)'},
    {key:'could_be', label:'Could be', bg:'var(--amber-bg)', fg:'var(--amber)'},
    {key:'close', label:'Close', bg:'#E7ECFA', fg:'#3B57C9'},
  ];
  const wordChip = (text, bg, fg) => `<span class="pill" style="background:${bg};color:${fg}">${esc(text)}</span>`;
  const chipBoard = (title, slot) => {
    const groups = VERDICTS.map(v => {
      const words = wordsByVerdict(slot, v.key);
      if(!words.length) return '';
      return `<div style="margin-bottom:8px">
        <span style="font-size:10.5px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.04em">${v.label}</span>
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:4px">${words.map(e=>wordChip(e.payload.text, v.bg, v.fg)).join('')}</div>
      </div>`;
    }).join('');
    return `<div style="flex:1;min-width:0">
      <h4 style="margin:0 0 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700">${title}</h4>
      ${groups || `<span style="font-size:12.5px;color:var(--muted);font-style:italic">Nothing yet</span>`}
    </div>`;
  };

  const guessesBlock = guesses.length ? `<div class="card">
    <h4 style="margin:0 0 8px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700">Category guesses</h4>
    ${guesses.slice().reverse().map(e=>{
      const isMe = e.slot===S.my_slot;
      return `<div class="gline"><span style="font-size:13.5px">${isMe?'You':esc(opp()?.name||'They')} guessed <b>${esc(e.payload.text)}</b> ${e.payload.correct?'✅ correct':'❌ not quite'}</span></div>`;
    }).join('')}
  </div>` : '';

  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="turn ${myTurn?'you':'them'}"><span class="dot"></span>${pend?(iAmJudge?`Judge ${esc(opp()?.name||'their')} ${pend.kind==='word'?'word':'guess'}`:`Waiting on ${esc(opp()?.name||'their')} judgment`):myTurn?`Your turn`:`${esc(opp()?.name||'Opponent')}'s turn`}</div>
  <div class="card" style="padding:13px 16px;margin-bottom:12px">
    <span style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700">Your category</span>
    <div style="font-size:17px;font-weight:700;margin-top:2px">${esc(S.my_secret||'')}</div>
  </div>
  ${actionBlock}
  <div class="grow"></div>
  <div class="card">
    <div style="display:flex;gap:16px">
      ${chipBoard('Fits their category', S.my_slot)}
      ${chipBoard('Fits your category', oppSlot())}
    </div>
  </div>
  ${guessesBlock}
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:12px auto 0">End game</button>`;
}
function viewDone(){
  const iWon = S.winner===S.my_slot;
  const rev = S.reveal||{};
  const mine = rev[String(S.my_slot)]||'—';
  const theirs = rev[String(oppSlot())]||'—';
  return `<div class="card"><div class="result">
      <span class="eyebrow" style="color:${iWon?'var(--green)':'var(--muted)'}">${iWon?'You win!':'Game over'}</span>
      <h2>${iWon?'You guessed it! 🎉':`${esc(opp()?.name||'Opponent')} wins`}</h2>
      <div class="reveal">
        <div><span class="lbl">Your category</span><span class="num" style="font-size:16px;letter-spacing:0">${esc(mine)}</span></div>
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
  else { html=viewCategoryEntry(); }
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
  document.querySelectorAll('#catMode button').forEach(b=>b.addEventListener('click',()=>{categoryMode=b.dataset.mode;render();}));
  on('lockCatBtn','click', ()=>{
    categorySelect=document.getElementById('catSelect')?.value||categorySelect;
    categoryCustom=document.getElementById('catCustom')?.value||categoryCustom;
    submitCategory();
  });
  document.querySelectorAll('#actionTabs button').forEach(b=>b.addEventListener('click',()=>{actionTab=b.dataset.tab;render();}));
  on('wordBtn','click', ()=>{ wordEntry=document.getElementById('wIn')?.value||''; submitWord(); });
  const wi=document.getElementById('wIn'); if(wi) wi.addEventListener('keydown',e=>{if(e.key==='Enter'){wordEntry=wi.value;submitWord();}});
  on('catGuessBtn','click', ()=>{ guessEntry=document.getElementById('gIn')?.value||''; submitGuess(); });
  const gi=document.getElementById('gIn'); if(gi) gi.addEventListener('keydown',e=>{if(e.key==='Enter'){guessEntry=gi.value;submitGuess();}});
  const pend = pendingEvent();
  on('judgeYes','click', ()=>{ if(!pend) return; pend.kind==='word' ? judgeWord(pend.id, 'yes') : judgeGuess(pend.id, true); });
  on('judgeNo','click', ()=>{ if(!pend) return; pend.kind==='word' ? judgeWord(pend.id, 'no') : judgeGuess(pend.id, false); });
  on('judgeCouldBe','click', ()=>{ if(!pend) return; judgeWord(pend.id, 'could_be'); });
  on('judgeClose','click', ()=>{ if(!pend) return; judgeWord(pend.id, 'close'); });
  on('leaveBtn','click', leaveGame);
  on('againBtn','click', playAgain);
}

export async function initFc(containerEl, chipEl, onExit){
  app=containerEl; chip=chipEl; exitToMenu=onExit;
  code=''; S=null; err=''; lastSig=''; categoryMode='preset'; categorySelect=''; categoryCustom='';
  actionTab='word'; wordEntry=''; guessEntry='';
  render();
}
export function teardownFc(){
  if(poll){ clearInterval(poll); poll=null; }
}
