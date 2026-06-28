import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL='https://iwwodozxqsgbaghndncs.supabase.co';
const SB_KEY='sb_publishable_dMtLijCoMrB4S7b6esp4oQ_ICgLZX0x';
const sb=createClient(SB_URL,SB_KEY);

function uid(){return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));}
let token=localStorage.getItem('ngg_token'); if(!token){token=uid();localStorage.setItem('ngg_token',token);}
let name=localStorage.getItem('ngg_name')||'';
let code=localStorage.getItem('ngg_code')||'';

let S=null, entry='', mode=null, err='', poll=null, lastSig='', lastResult=null;
let newDigits=4, newTeam=1, editSecret=false, newBotDiff='normal';

// ---- app screen: 'home' | 'online' | 'local' | 'bot' (online = existing multiplayer flow) ----
let screen='home';

// ============ LOCAL (pass-and-play, same device) ============
let LOC=null; // {digits, names:[p1,p2], secrets:[s1,s2], turn:1|2, guesses:[{by,guess,correct,right_place}], winner, phase:'secret1'|'secret2'|'reveal'|'play'|'done'}
function locScore(secret,guess){
  // Optimized: avoid string split()/filter() allocations (this gets called up to ~1M times
  // per bot turn at 6 digits during candidate filtering, so allocation-free matters a lot).
  let rp=0;
  const sCounts=new Int8Array(10), gCounts=new Int8Array(10);
  const len=secret.length;
  for(let i=0;i<len;i++){
    const sc=secret.charCodeAt(i)-48, gc=guess.charCodeAt(i)-48;
    if(sc===gc) rp++;
    sCounts[sc]++; gCounts[gc]++;
  }
  let correct=0;
  for(let d=0;d<10;d++) correct += Math.min(sCounts[d], gCounts[d]);
  return {correct, right_place:rp};
}
function locNew(digits){
  LOC={digits, names:[name||'Player 1','Partner'], secrets:['',''], turn:1,
       guesses:[], winner:null, phase:'secret1', pendingReveal:false};
  entry=''; screen='local'; render();
}
function locSubmitSecret(){
  if(entry.length!==LOC.digits){err='Enter all '+LOC.digits+' digits.';return render();}
  if(LOC.phase==='secret1'){ LOC.secrets[0]=entry; entry=''; LOC.phase='handoff1'; }
  else if(LOC.phase==='secret2'){ LOC.secrets[1]=entry; entry=''; LOC.phase='play'; }
  err=''; render();
}
function locSubmitGuess(){
  if(entry.length!==LOC.digits){err='Enter all '+LOC.digits+' digits.';return render();}
  const guesser=LOC.turn, oppIdx=guesser===1?1:0;
  const r=locScore(LOC.secrets[oppIdx], entry);
  LOC.guesses.push({by:guesser, guess:entry, correct:r.correct, right_place:r.right_place});
  entry='';
  if(r.right_place===LOC.digits){ LOC.winner=guesser; LOC.phase='done'; }
  else { LOC.turn = guesser===1?2:1; LOC.phase='handoffPlay'; }
  err=''; render();
}
function locAdvance(){
  // called when "reveal"/"pass" screen's continue button is tapped
  if(LOC.phase==='handoff1'){ LOC.phase='secret2'; }
  else if(LOC.phase==='handoffPlay'){ LOC.phase='play'; }
  render();
}

// ============ VS BOT ============
let BOT=null; // {digits, difficulty, mySecret, botSecret, turn:'me'|'bot', guesses:[{by,guess,correct,right_place}], winner, phase:'secret'|'play'|'done', candidates:[]}

function randomDigitString(digits){
  let s=''; for(let i=0;i<digits;i++) s+=Math.floor(Math.random()*10);
  return s;
}
function allCombos(digits){
  // Materializes every possible digit string (10,000 / 100,000 / 1,000,000 for 4/5/6 digits).
  // Safe to do even at 6 digits because locScore() above is allocation-free — a full filter
  // pass over 1M entries takes well under 200ms, so this never blocks the UI noticeably.
  const out=new Array(Math.pow(10,digits));
  for(let n=0;n<out.length;n++) out[n]=n.toString().padStart(digits,'0');
  return out;
}
function botNew(digits, difficulty){
  const botSecret=randomDigitString(digits);
  BOT={digits, difficulty, mySecret:'', botSecret, turn:'me', guesses:[], winner:null, phase:'secret',
       candidates: difficulty==='hard' ? allCombos(digits) : null, lastBotGuess:null};
  entry=''; screen='bot'; render();
}
function botSubmitSecret(){
  if(entry.length!==BOT.digits){err='Enter all '+BOT.digits+' digits.';return render();}
  BOT.mySecret=entry; entry=''; BOT.phase='play'; err=''; render();
}
function botSubmitGuess(){
  if(entry.length!==BOT.digits){err='Enter all '+BOT.digits+' digits.';return render();}
  const r=locScore(BOT.botSecret, entry);
  BOT.guesses.push({by:'me', guess:entry, correct:r.correct, right_place:r.right_place});
  entry='';
  if(r.right_place===BOT.digits){ BOT.winner='me'; BOT.phase='done'; render(); return; }
  // bot's turn
  setTimeout(()=>{ botTakeTurn(); }, 450);
  BOT.turn='bot'; render();
}
function botPickGuess(){
  const digits=BOT.digits;
  if(BOT.difficulty==='easy'){
    return randomDigitString(digits);
  }
  if(BOT.difficulty==='hard'){
    // constraint-satisfaction: candidates already filtered after each guess; pick randomly among survivors.
    if(!BOT.candidates.length) return randomDigitString(digits); // shouldn't happen, but stay safe
    return BOT.candidates[Math.floor(Math.random()*BOT.candidates.length)];
  }
  // normal: bias toward digits confirmed present, otherwise mostly random with light memory
  const myGuesses=BOT.guesses.filter(g=>g.by==='bot');
  const known=new Set();
  myGuesses.forEach(g=>{ if(g.correct>0) g.guess.split('').forEach(d=>known.add(d)); });
  let attempt='';
  const knownArr=[...known];
  for(let i=0;i<digits;i++){
    if(knownArr.length && Math.random()<0.55) attempt+=knownArr[Math.floor(Math.random()*knownArr.length)];
    else attempt+=Math.floor(Math.random()*10);
  }
  return attempt;
}
function botTakeTurn(){
  const guess=botPickGuess();
  const r=locScore(BOT.mySecret, guess);
  BOT.guesses.push({by:'bot', guess, correct:r.correct, right_place:r.right_place});
  BOT.lastBotGuess={...r, guess};
  if(BOT.difficulty==='hard'){
    // narrow candidate set to those consistent with this exact feedback against this guess.
    // Full candidate space is always materialized (see allCombos), so this can never run dry
    // unless the secret itself wasn't a valid digit string, which shouldn't happen.
    BOT.candidates = BOT.candidates.filter(c=>{ const s=locScore(c,guess); return s.correct===r.correct && s.right_place===r.right_place; });
  }
  if(r.right_place===BOT.digits){ BOT.winner='bot'; BOT.phase='done'; }
  else { BOT.turn='me'; }
  render();
}

let app, chip;
const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sp=s=>String(s).split('').join(' ');

async function rpc(fn,args){const{data,error}=await sb.rpc(fn,args); if(error) throw new Error((error.message||'').replace(/^.*?:\s*/,'')||'error'); return data;}
const FR={GAME_NOT_FOUND:'No game with that code. Check it and try again.',GAME_FULL:'That game is already full.',
  NOT_YOUR_TURN:'Hold on — it’s not your turn yet.',NOT_PLAYING:'The game isn’t ready yet.',
  BAD_GUESS:'Enter all the digits first.',BAD_SECRET:'Enter all the digits first.',
  LOCKED:'The game already started — numbers are locked.',NOT_A_PLAYER:'You’re not in this game anymore.'};
const fr=m=>FR[m]||m||'Something went wrong.';

// ---- helpers ----
const P=()=>S?.players||[];
const teamOf=t=>P().filter(p=>p.team===t);
const oppT=()=>S.my_team===1?2:1;
const nameOfSlot=s=>(P().find(p=>p.slot===s)||{}).name||'someone';
const isTeam=()=>!!S && S.team_size>1;
const teamTitle=t=>isTeam()?('Team '+t):(t===S.my_team?'You':(teamOf(t)[0]?.name||'Opponent'));
const vsLabel=()=>isTeam()?('Team '+oppT()):(teamOf(oppT())[0]?.name||'your opponent');
const secretSet=t=>!!(S.secrets&&S.secrets[String(t)]);

// ---- actions ----
function grabName(){const el=document.getElementById('nameIn'); if(el) name=el.value;}
async function createGame(){
  err=''; grabName(); name=(name||'').trim(); if(name) localStorage.setItem('ngg_name',name);
  try{ code=await rpc('ngg_create_game',{p_digits:newDigits,p_team_size:newTeam,p_name:name,p_token:token});
    localStorage.setItem('ngg_code',code); entry=''; editSecret=false; await refresh(true); startPoll();
  }catch(e){err=fr(e.message);render();}
}
async function joinGame(){
  err=''; grabName(); name=(name||'').trim(); if(name) localStorage.setItem('ngg_name',name);
  const cd=(document.getElementById('codeIn')?.value||'').trim().toUpperCase();
  if(cd.length<4){err='Enter the 4-letter game code.';return render();}
  try{ await rpc('ngg_join_game',{p_code:cd,p_name:name,p_token:token});
    code=cd; localStorage.setItem('ngg_code',cd); entry=''; editSecret=false; await refresh(true); startPoll();
  }catch(e){err=fr(e.message);render();}
}
async function submitSecret(){
  err=''; if(entry.length!==S.digits){err='Enter all '+S.digits+' digits.';return render();}
  try{ await rpc('ngg_set_secret',{p_code:code,p_token:token,p_secret:entry}); entry=''; mode=null; editSecret=false; await refresh(true);}
  catch(e){err=fr(e.message);render();}
}
async function submitGuess(){
  err=''; if(entry.length!==S.digits){err='Enter all '+S.digits+' digits.';return render();}
  try{ const r=await rpc('ngg_make_guess',{p_code:code,p_token:token,p_guess:entry}); entry=''; lastResult={...r,guess:entry?entry:r.guess}; await refresh(true);}
  catch(e){err=fr(e.message);render();}
}
function leaveGame(){ if(poll){clearInterval(poll);poll=null;} code='';S=null;entry='';mode=null;err='';lastResult=null;lastSig='';editSecret=false;
  localStorage.removeItem('ngg_code'); screen='home'; render(); }

// ---- polling ----
function startPoll(){ if(poll) clearInterval(poll); poll=setInterval(()=>refresh(false),1500); }
async function refresh(force){
  if(!code) return;
  try{ const d=await rpc('ngg_state',{p_code:code,p_token:token}); S=d;
    const sig=[S.status,S.turn,S.winner,(S.guesses||[]).length,(S.players||[]).length,JSON.stringify(S.secrets)].join('|');
    if(force||sig!==lastSig){lastSig=sig;render();}
    if(S.status==='finished'&&poll){clearInterval(poll);poll=null;}
  }catch(e){ if(/GAME_NOT_FOUND/.test(e.message)) leaveGame(); }
}

// ---- keypad ----
function activeDigits(){
  if(screen==='local') return LOC?.digits||6;
  if(screen==='bot') return BOT?.digits||6;
  return S?.digits||6;
}
function isSecretEntry(){
  if(screen==='local') return LOC && (LOC.phase==='secret1'||LOC.phase==='secret2');
  if(screen==='bot') return BOT && BOT.phase==='secret';
  return mode==='secret';
}
function press(d){const max=activeDigits(); if(entry.length<max){entry+=d;renderEntry();}}
function back(){entry=entry.slice(0,-1);renderEntry();}
function renderEntry(){
  const box=document.getElementById('slots'); if(!box) return;
  const max=activeDigits(), secret=isSecretEntry();
  let h=''; for(let i=0;i<max;i++){const f=i<entry.length;
    h+=`<div class="slot ${f?'on filled':''}">${secret?'':(f?esc(entry[i]):(i===entry.length?'<span class=cur></span>':''))}</div>`;}
  box.innerHTML=h;
  const a=document.getElementById('actBtn'); if(a) a.disabled=entry.length!==max;
}
const keypad=()=>`<div class="pad">
  ${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="key" data-k="${n}">${n}</button>`).join('')}
  <button class="key util" data-act="back">⌫</button>
  <button class="key" data-k="0">0</button>
  <button class="key util" data-act="clear">clear</button></div>`;

// ---- record rendering ----
function rows(list,digits){
  if(!list.length) return `<div class="empty">No guesses yet.</div>`;
  return list.map((g,i)=>{const win=g.right_place===digits;
    return `<div class="gline ${win?'winrow':''}">
      <span class="gnum">${i+1}</span>
      <span class="gdigits ${win?'win':''}">${sp(g.guess)}</span>
      ${isTeam()?`<span class="tag">${esc(g.name)}</span>`:''}
      <span class="pill place">◉ ${g.right_place}</span>
      <span class="pill corr">◆ ${g.correct}</span></div>`;}).join('');
}
const receipt=(title,count,html)=>`<div class="receipt">
  <div class="rhead"><span class="who">${title}</span><span class="cnt">${count} ${count===1?'guess':'guesses'}</span></div>${html}</div>`;
const legend=`<div class="legend">
  <span><span class="swatch" style="background:var(--green)"></span>◉ right digit, right spot</span>
  <span><span class="swatch" style="background:var(--amber)"></span>◆ right digit (total correct)</span></div>`;

// ---- rosters ----
function rosterBox(t){
  const mem=teamOf(t), n=S.team_size;
  let li=mem.map(p=>`<li>${esc(p.name)}${p.slot===S.my_slot?' <em>(you)</em>':''}</li>`);
  for(let i=mem.length;i<n;i++) li.push('<li class="w">waiting…</li>');
  return `<div class="teambox ${t===S.my_team?'mine':''}">
    <h4>${teamTitle(t)}${t===S.my_team&&isTeam()?' · you':''}</h4>
    <ul>${li.join('')}</ul>
    <span class="secflag">${secretSet(t)?'✓ number locked':''}</span></div>`;
}

// ---- screens ----
function viewModeSelect(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ Arcade menu</button>
  <div class="card">
    <p class="lede">A quick code-cracking game. Pick a secret number, then trade guesses — every guess tells you how many digits are right, and how many sit in the right spot.</p>
  </div>
  <div class="modegrid">
    <button class="modecard primary" id="goOnline">
      <span class="micon">🌐</span><span class="mtitle">Online / Private lobby</span><span class="msub">Share a code, play on two phones</span>
    </button>
    <button class="modecard" id="goLocal">
      <span class="micon">📱</span><span class="mtitle">Local · pass &amp; play</span><span class="msub">One phone, hand it back and forth</span>
    </button>
    <button class="modecard" id="goBot">
      <span class="micon">🤖</span><span class="mtitle">Vs Bot</span><span class="msub">Practice solo, pick a difficulty</span>
    </button>
  </div>`;
}
function viewOnlineSetup(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ All modes</button>
  <div class="card">
    <p class="lede">Play with someone on another phone — start a game and share the 4-letter code, or join theirs.</p>
    <label class="fld" for="nameIn">Your name</label>
    <input class="text" id="nameIn" maxlength="16" placeholder="e.g. ${esc(name||'Nihal')}" value="${esc(name)}" />
    <div style="height:18px"></div>
    <label class="fld">Players</label>
    <div class="seg" id="segTeam">
      <button data-t="1" aria-pressed="${newTeam===1}">1 v 1</button>
      <button data-t="2" aria-pressed="${newTeam===2}">2 v 2</button>
      <button data-t="3" aria-pressed="${newTeam===3}">3 v 3</button>
    </div>
    <div style="height:14px"></div>
    <label class="fld">Number length</label>
    <div class="seg" id="segDig">
      <button data-d="4" aria-pressed="${newDigits===4}">4 digits</button>
      <button data-d="5" aria-pressed="${newDigits===5}">5 digits</button>
      <button data-d="6" aria-pressed="${newDigits===6}">6 digits</button>
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

// ---- LOCAL screens ----
function viewLocalSetup(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ All modes</button>
  <div class="card">
    <p class="lede">Two players, one phone. You'll each set a secret number, then pass the phone back and forth each turn — we'll hide the screen in between so no one peeks.</p>
    <label class="fld" for="loc1">Player 1 name</label>
    <input class="text" id="loc1" maxlength="16" placeholder="e.g. ${esc(name||'You')}" value="${esc(name)}" />
    <div style="height:14px"></div>
    <label class="fld" for="loc2">Player 2 name</label>
    <input class="text" id="loc2" maxlength="16" placeholder="e.g. Partner" />
    <div style="height:18px"></div>
    <label class="fld">Number length</label>
    <div class="seg" id="segDigLoc">
      <button data-d="4" aria-pressed="${newDigits===4}">4 digits</button>
      <button data-d="5" aria-pressed="${newDigits===5}">5 digits</button>
      <button data-d="6" aria-pressed="${newDigits===6}">6 digits</button>
    </div>
    <div style="height:16px"></div>
    <button class="btn" id="startLocalBtn">Start</button>
  </div>`;
}
function viewLocalHandoff(toIdx, reason){
  const toName=LOC.names[toIdx-1];
  const msg = reason==='secret' ? `Pass the phone to <b>${esc(toName)}</b> so they can set their secret number.`
                                  : `Pass the phone to <b>${esc(toName)}</b> for their turn.`;
  return `<div class="card" style="text-align:center;padding:34px 20px">
    <div style="font-size:38px;margin-bottom:8px">🤝</div>
    <p class="lede" style="margin:0 0 18px">${msg}</p>
    <button class="btn" id="revealBtn">I'm ${esc(toName)} — show my screen</button>
  </div>`;
}
function viewLocalSecret(idx){
  const who=LOC.names[idx-1];
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="card secret">
    <p class="lede"><b>${esc(who)}</b>, pick your secret <b>${LOC.digits}-digit number</b>. Keep it hidden — repeats and a leading zero are fine.</p>
    <div class="slots" id="slots"></div>${keypad()}<div style="height:14px"></div>
    <button class="btn" id="actBtn" disabled>Lock in my number</button>
  </div>`;
}
function viewLocalPlay(){
  const turn=LOC.turn, who=LOC.names[turn-1], oppName=LOC.names[turn===1?1:0];
  const myGuesses=LOC.guesses.filter(g=>g.by===turn);
  const theirGuesses=LOC.guesses.filter(g=>g.by!==turn);
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="turn you"><span class="dot"></span><b>${esc(who)}'s turn</b> — guess ${esc(oppName)}'s number</div>
  <div class="card">
    <div class="slots" id="slots"></div>${keypad()}<div style="height:14px"></div>
    <button class="btn" id="actBtn" disabled>Submit guess</button>
  </div>
  <div class="grow"></div>
  ${receipt(`${esc(who)} · guessing ${esc(oppName)}`, myGuesses.length, rows(myGuesses,LOC.digits))}
  <div style="height:14px"></div>
  ${receipt(`${esc(oppName)} · guessing ${esc(who)}`, theirGuesses.length, rows(theirGuesses,LOC.digits))}
  ${legend}
  <button class="linkbtn" id="leaveLocalBtn" style="display:block;margin:12px auto 0">End game</button>`;
}
function viewLocalDone(){
  const winner=LOC.winner, winnerName=LOC.names[winner-1], loserName=LOC.names[winner===1?1:0];
  const winGuesses=LOC.guesses.filter(g=>g.by===winner);
  return `<div class="card"><div class="result">
      <span class="eyebrow" style="color:var(--green)">Game over</span>
      <h2>${esc(winnerName)} wins! 🎉</h2>
      <p class="lede" style="margin:2px 0 0">Cracked ${esc(loserName)}'s number in ${winGuesses.length} ${winGuesses.length===1?'try':'tries'}.</p>
      <div class="reveal">
        <div><span class="lbl">${esc(LOC.names[0])}</span><span class="num">${sp(LOC.secrets[0])}</span></div>
        <div><span class="lbl">${esc(LOC.names[1])}</span><span class="num">${sp(LOC.secrets[1])}</span></div>
      </div></div>
    <button class="btn" id="againLocalBtn">Play again</button>
  </div>
  <div class="grow"></div>
  ${receipt(`Full record`, LOC.guesses.length, rows(LOC.guesses.map(g=>({...g,name:LOC.names[g.by-1]})),LOC.digits))}
  ${legend}`;
}

// ---- BOT screens ----
function viewBotSetup(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ All modes</button>
  <div class="card">
    <p class="lede">Practice against the computer. Pick a difficulty — Hard plays a real deduction strategy, so it gets sharper with every guess it makes.</p>
    <label class="fld">Difficulty</label>
    <div class="seg" id="segBotDiff">
      <button data-diff="easy" aria-pressed="${newBotDiff==='easy'}">Easy</button>
      <button data-diff="normal" aria-pressed="${newBotDiff==='normal'}">Normal</button>
      <button data-diff="hard" aria-pressed="${newBotDiff==='hard'}">Hard</button>
    </div>
    <div style="height:14px"></div>
    <label class="fld">Number length</label>
    <div class="seg" id="segDigBot">
      <button data-d="4" aria-pressed="${newDigits===4}">4 digits</button>
      <button data-d="5" aria-pressed="${newDigits===5}">5 digits</button>
      <button data-d="6" aria-pressed="${newDigits===6}">6 digits</button>
    </div>
    <div style="height:16px"></div>
    <button class="btn" id="startBotBtn">Start</button>
  </div>`;
}
function viewBotSecret(){
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <button class="linkbtn" id="backHome" style="display:block;margin:0 0 10px">‹ All modes</button>
  <div class="card secret">
    <p class="lede">Pick your secret <b>${BOT.digits}-digit number</b>. The bot can't see this — repeats and a leading zero are fine.</p>
    <div class="slots" id="slots"></div>${keypad()}<div style="height:14px"></div>
    <button class="btn" id="actBtn" disabled>Lock in my number</button>
  </div>`;
}
function viewBotPlay(){
  const myTurn=BOT.turn==='me';
  const myGuesses=BOT.guesses.filter(g=>g.by==='me');
  const botGuesses=BOT.guesses.filter(g=>g.by==='bot');
  const diffLabel={easy:'Easy',normal:'Normal',hard:'Hard'}[BOT.difficulty];
  const last=BOT.lastBotGuess;
  // Show a summary of the bot's most recent guess against you, just above the keypad,
  // for the turn right after it made that guess.
  const flash=(myTurn && last) ? `<div class="card" style="padding:13px 16px;margin-bottom:14px">
      <p class="lede" style="margin:0 0 8px;text-align:center">The bot just guessed:</p>
      <div style="display:flex;align-items:center;gap:10px;justify-content:center;flex-wrap:wrap">
      <span class="gdigits" style="flex:none">${sp(last.guess)}</span>
      <span class="pill place">◉ ${last.right_place} in place</span>
      <span class="pill corr">◆ ${last.correct} correct</span></div></div>` : '';
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="mynum"><span>Your number</span><b>${sp(BOT.mySecret)}</b></div>
  <div class="turn ${myTurn?'you':'them'}"><span class="dot"></span>${myTurn?`Your turn — guess the bot's number (${diffLabel})`:`Bot (${diffLabel}) is thinking…`}</div>
  ${flash}
  ${myTurn?`<div class="card">
    <div class="slots" id="slots"></div>${keypad()}<div style="height:14px"></div>
    <button class="btn" id="actBtn" disabled>Submit guess</button></div>`:''}
  <div class="grow"></div>
  ${receipt(`You · guessing bot`, myGuesses.length, rows(myGuesses,BOT.digits))}
  <div style="height:14px"></div>
  ${receipt(`Bot · guessing you`, botGuesses.length, rows(botGuesses,BOT.digits))}
  ${legend}
  <button class="linkbtn" id="leaveBotBtn" style="display:block;margin:12px auto 0">End game</button>`;
}
function viewBotDone(){
  const iWon=BOT.winner==='me';
  const myGuesses=BOT.guesses.filter(g=>g.by==='me');
  const botGuesses=BOT.guesses.filter(g=>g.by==='bot');
  return `<div class="card"><div class="result">
      <span class="eyebrow" style="color:${iWon?'var(--green)':'var(--muted)'}">${iWon?'You cracked it':'Game over'}</span>
      <h2>${iWon?'You win! 🎉':'The bot wins'}</h2>
      <p class="lede" style="margin:2px 0 0">${iWon?`You guessed it in ${myGuesses.length} ${myGuesses.length===1?'try':'tries'}.`:`The bot cracked your number first.`}</p>
      <div class="reveal">
        <div><span class="lbl">You</span><span class="num">${sp(BOT.mySecret)}</span></div>
        <div><span class="lbl">Bot</span><span class="num">${sp(BOT.botSecret)}</span></div>
      </div></div>
    <button class="btn" id="againBotBtn">Play again</button>
  </div>
  <div class="grow"></div>
  ${receipt(`You · guesses`, myGuesses.length, rows(myGuesses,BOT.digits))}
  <div style="height:14px"></div>
  ${receipt(`Bot · guesses`, botGuesses.length, rows(botGuesses,BOT.digits))}
  ${legend}`;
}

function viewLobby(){
  const need=S.need, have=P().length, full=have>=need;
  const mySet=!!S.my_secret, showPad=!mySet||editSecret;
  const numWord=isTeam()?"your team's":"your";
  // status line
  let status;
  if(!full){ const left=need-have; status=`Waiting for ${left} more player${left>1?'s':''}. Share the code.`; }
  else if(!(secretSet(1)&&secretSet(2))){
    const waitT = !secretSet(1)?1:2;
    status = waitT===S.my_team ? `Your team still needs to lock in a number.` : `Waiting for ${teamTitle(waitT)} to choose a number…`;
  } else status='Starting…';
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="card">
    <div class="bigcode">${esc(S.code)}</div>
    <button class="copybtn" id="copyBtn">Copy game code</button>
    <div class="rosters">${rosterBox(1)}${rosterBox(2)}</div>
    <div class="turn them" style="margin:8px 0 4px"><span class="dot"></span>${status}</div>
  </div>
  <div class="card ${showPad?'secret':''}">
    ${showPad?`<p class="lede">Pick ${numWord} secret <b>${S.digits}-digit number</b>. ${isTeam()?'One number for the whole team — agree on it together.':'Keep it hidden from '+vsLabel()+'!'} Repeats and a leading zero are fine.</p>
      <div class="slots" id="slots"></div>${keypad()}<div style="height:14px"></div>
      <button class="btn" id="actBtn" disabled>${mySet?'Update our number':'Lock in '+(isTeam()?'our':'my')+' number'}</button>
      ${mySet?`<button class="linkbtn" id="cancelEdit" style="display:block;margin:10px auto 0">Keep current number</button>`:''}`
    :`<p class="lede" style="margin-bottom:10px">${isTeam()?"Your team's number is locked in.":"Your number is locked in."}</p>
      <div class="locked">${sp(S.my_secret)}</div>
      <div class="setby">${isTeam()&&S.secrets[String(S.my_team)]?'set by '+esc(S.secrets[String(S.my_team)]):'only your side can see this'}</div>
      <button class="btn ghost" id="changeBtn">Change our number</button>`}
  </div>
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:14px auto 0">Leave game</button>`;
}
function viewPlay(){
  const me=S.my_slot, myTurn=S.turn===me;
  const ours=(S.guesses||[]).filter(g=>g.team===S.my_team);
  const theirs=(S.guesses||[]).filter(g=>g.team!==S.my_team);
  const numLbl=isTeam()?"Your team's number":"Your number";
  const last=(S.guesses||[])[(S.guesses||[]).length-1];
  const showFlash=lastResult&&last&&last.slot===me;
  const flash=showFlash?`<div class="card" style="padding:13px 16px;margin-bottom:14px"><div style="display:flex;align-items:center;gap:10px;justify-content:center;flex-wrap:wrap">
      <span class="gdigits" style="flex:none">${sp(lastResult.guess)}</span>
      <span class="pill place">◉ ${lastResult.right_place} in place</span>
      <span class="pill corr">◆ ${lastResult.correct} correct</span></div></div>`:'';
  const activeName=nameOfSlot(S.turn);
  const turnTxt=myTurn?`Your turn — guess ${vsLabel()}’s number`
    :`Waiting for ${esc(activeName)}${isTeam()?` (Team ${S.turn_team})`:''} to guess…`;
  return `${err?`<div class="err">${esc(err)}</div>`:''}
  <div class="mynum"><span>${numLbl}</span><b>${S.my_secret?sp(S.my_secret):'—'}</b></div>
  <div class="turn ${myTurn?'you':'them'}"><span class="dot"></span>${turnTxt}</div>
  ${myTurn?`<div class="card">
    <div class="slots" id="slots"></div>${keypad()}<div style="height:14px"></div>
    <button class="btn" id="actBtn" disabled>Submit guess</button></div>`:flash}
  <div class="grow"></div>
  ${receipt(`${isTeam()?'Your team':'You'} · guessing ${vsLabel()}`, ours.length, rows(ours,S.digits))}
  <div style="height:14px"></div>
  ${receipt(`${vsLabel()} · guessing ${isTeam()?'your team':'you'}`, theirs.length, rows(theirs,S.digits))}
  ${legend}
  <button class="linkbtn" id="leaveBtn" style="display:block;margin:12px auto 0">Leave game</button>`;
}
function viewDone(){
  const iWon=S.winner===S.my_team;
  const ours=(S.guesses||[]).filter(g=>g.team===S.my_team);
  const theirs=(S.guesses||[]).filter(g=>g.team!==S.my_team);
  const rev=S.reveal||{}; const mine=rev[String(S.my_team)]??'—'; const their=rev[String(oppT())]??'—';
  const winLabel=isTeam()?`Team ${S.winner}`:nameOfSlot((teamOf(S.winner)[0]||{}).slot);
  return `<div class="card"><div class="result">
      <span class="eyebrow" style="color:${iWon?'var(--green)':'var(--muted)'}">${iWon?'You cracked it':'Game over'}</span>
      <h2>${iWon?'You win! 🎉':`${esc(winLabel)} wins`}</h2>
      <p class="lede" style="margin:2px 0 0">${iWon?`${isTeam()?'Your team':'You'} guessed it in ${ours.length} ${ours.length===1?'try':'tries'}.`:`${esc(vsLabel())} cracked your number first.`}</p>
      <div class="reveal">
        <div><span class="lbl">${isTeam()?'Your team':'You'}</span><span class="num">${sp(mine)}</span></div>
        <div><span class="lbl">${esc(vsLabel())}</span><span class="num">${sp(their)}</span></div>
      </div></div>
    <button class="btn" id="againBtn">Play again</button>
  </div>
  <div class="grow"></div>
  ${receipt(`${isTeam()?'Your team':'You'} · guesses`, ours.length, rows(ours,S.digits))}
  <div style="height:14px"></div>
  ${receipt(`${esc(vsLabel())} · guesses`, theirs.length, rows(theirs,S.digits))}
  ${legend}`;
}

function render(){
  chip.innerHTML=(S&&code&&S.status!=='finished'&&screen==='online')?`<div class="codechip"><small>CODE</small>${esc(S.code)}</div>`:'';
  let html;
  if(screen==='home'){ html=viewModeSelect(); }
  else if(screen==='local'){
    if(!LOC) html=viewLocalSetup();
    else if(LOC.phase==='secret1') html=viewLocalSecret(1);
    else if(LOC.phase==='handoff1') html=viewLocalHandoff(2,'secret');
    else if(LOC.phase==='secret2') html=viewLocalSecret(2);
    else if(LOC.phase==='handoffPlay') html=viewLocalHandoff(LOC.turn,'turn');
    else if(LOC.phase==='play') html=viewLocalPlay();
    else if(LOC.phase==='done') html=viewLocalDone();
  }
  else if(screen==='bot'){
    if(!BOT) html=viewBotSetup();
    else if(BOT.phase==='secret') html=viewBotSecret();
    else if(BOT.phase==='play') html=viewBotPlay();
    else if(BOT.phase==='done') html=viewBotDone();
  }
  else { // online
    if(!code||!S) html=viewOnlineSetup();
    else if(S.status==='finished') html=viewDone();
    else if(S.status==='playing') html=viewPlay();
    else { mode=( !S.my_secret || editSecret )?'secret':null; html=viewLobby(); }
  }
  app.innerHTML=html; wire();
  if(document.getElementById('slots')) renderEntry();
}
function goHome(){ if (typeof exitToMenu === 'function') exitToMenu(); }
function wire(){
  const on=(id,ev,fn)=>{const el=document.getElementById(id); if(el) el.addEventListener(ev,fn);};
  // mode select
  on('goOnline','click',()=>{screen='online';entry='';err='';render();});
  on('goLocal','click',()=>{screen='local';LOC=null;entry='';err='';render();});
  on('goBot','click',()=>{screen='bot';BOT=null;entry='';err='';render();});
  on('backHome','click',goHome);
  // online (existing)
  on('createBtn','click',createGame); on('joinBtn','click',joinGame);
  document.querySelectorAll('#segTeam button').forEach(b=>b.addEventListener('click',()=>{grabName();newTeam=+b.dataset.t;render();}));
  document.querySelectorAll('#segDig button').forEach(b=>b.addEventListener('click',()=>{grabName();newDigits=+b.dataset.d;render();}));
  const ci=document.getElementById('codeIn'); if(ci) ci.addEventListener('keydown',e=>{if(e.key==='Enter')joinGame();});
  on('changeBtn','click',()=>{editSecret=true;entry='';err='';render();});
  on('cancelEdit','click',()=>{editSecret=false;entry='';render();});
  on('copyBtn','click',async()=>{try{await navigator.clipboard.writeText(S.code);const b=document.getElementById('copyBtn');b.textContent='Copied ✓';setTimeout(()=>b.textContent='Copy game code',1400);}catch(e){}});
  on('leaveBtn','click',leaveGame); on('againBtn','click',leaveGame);
  // local setup
  document.querySelectorAll('#segDigLoc button').forEach(b=>b.addEventListener('click',()=>{newDigits=+b.dataset.d;render();}));
  on('startLocalBtn','click',()=>{
    const n1=(document.getElementById('loc1')?.value||'').trim()||'Player 1';
    const n2=(document.getElementById('loc2')?.value||'').trim()||'Player 2';
    if(n1) localStorage.setItem('ngg_name',n1), name=n1;
    locNew(newDigits); LOC.names=[n1,n2];
  });
  on('revealBtn','click',locAdvance);
  on('leaveLocalBtn','click',goHome);
  on('againLocalBtn','click',()=>{screen='local';LOC=null;render();});
  // bot setup
  document.querySelectorAll('#segDigBot button').forEach(b=>b.addEventListener('click',()=>{newDigits=+b.dataset.d;render();}));
  document.querySelectorAll('#segBotDiff button').forEach(b=>b.addEventListener('click',()=>{newBotDiff=b.dataset.diff;render();}));
  on('startBotBtn','click',()=>{ botNew(newDigits,newBotDiff); });
  on('leaveBotBtn','click',goHome);
  on('againBotBtn','click',()=>{screen='bot';BOT=null;render();});
  // shared keypad + action button (mode-aware)
  document.querySelectorAll('.key[data-k]').forEach(k=>k.addEventListener('click',()=>press(k.dataset.k)));
  document.querySelectorAll('.key[data-act]').forEach(k=>k.addEventListener('click',()=>{k.dataset.act==='back'?back():(entry='',renderEntry());}));
  on('actBtn','click',()=>{
    if(screen==='local'){ (LOC.phase==='secret1'||LOC.phase==='secret2') ? locSubmitSecret() : locSubmitGuess(); }
    else if(screen==='bot'){ BOT.phase==='secret' ? botSubmitSecret() : botSubmitGuess(); }
    else { mode==='secret'?submitSecret():submitGuess(); }
  });
}
let _keyHandler=null;
let exitToMenu=null;

export async function initDigits(containerEl, chipEl, onExit){
  app = containerEl; chip = chipEl; exitToMenu = onExit;
  if(_keyHandler) window.removeEventListener('keydown', _keyHandler);
  _keyHandler = (e)=>{
    if(!document.getElementById('slots')) return;
    if(/^[0-9]$/.test(e.key)) press(e.key);
    else if(e.key==='Backspace') back();
    else if(e.key==='Enter'){const a=document.getElementById('actBtn'); if(a&&!a.disabled) a.click();}
  };
  window.addEventListener('keydown', _keyHandler);
  if(code){ screen='online'; mode=null; render(); await refresh(true); if(code) startPoll(); }
  else { screen='home'; render(); }
}

export function teardownDigits(){
  if(poll){ clearInterval(poll); poll=null; }
  if(_keyHandler){ window.removeEventListener('keydown', _keyHandler); _keyHandler=null; }
}
