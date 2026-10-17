'use strict';
const $ = (id) => document.getElementById(id);
const states = { controller: null, url: null, working: false };
const SPEAKERS_V3 = [
  ['shubh','Shubh · Natural'], ['priya','Priya · Warm'], ['ritu','Ritu · Clear'],
  ['ratan','Ratan · Deep'], ['ishita','Ishita · Smooth'], ['neha','Neha · Bright'],
  ['rohan','Rohan · Conversational'], ['simran','Simran · Expressive'], ['kavya','Kavya · Story'],
  ['rahul','Rahul · Calm'], ['pooja','Pooja · Friendly']
];
const SPEAKERS_V4 = [
  ['','Automatic voice (Sarvam default)'], ['aparna_en_edtech','Aparna · English · Educator'],
  ['simran_en_customer','Simran · English · Conversational'],
  ['shubh_en_recovery','Shubh · English · Soft'],
  ['aparna_en_companion','Aparna · English · Empathetic'],
  ['simran_enhi_customer','Simran · Hinglish · Conversational'],
  ['aparna_hi_customer','Aparna · Hindi · Warm'],
  ['shubh_hi_customer','Shubh · Hindi · Confident'],
  ['ritu_hi_customer','Ritu · Hindi · Clear'],
  ['ratan_hi_customer_expressive','Ratan · Hindi · Expressive'],
  ['shubh_enhi_ads','Shubh · Hinglish · Advertising']
];
const presets = {
  neutral:{pace:1, temperature:0.6, pause:0.4, v3:'shubh', v4:'simran_en_customer'},
  news:{pace:1.08, temperature:0.38, pause:0.24, v3:'ratan', v4:'shubh_en_recovery'},
  fiction:{pace:0.9, temperature:0.78, pause:0.7, v3:'kavya', v4:'ratan_hi_customer_expressive'},
  education:{pace:0.91, temperature:0.35, pause:0.65, v3:'ishita', v4:'aparna_en_edtech'}
};
const sample = 'The best stories do not simply tell us what happened. They help us feel that we were there.\n\nImagine a quiet afternoon in Hyderabad, a cup of chai on your desk, and an idea waiting to be shared. Every sentence is a chance to connect.\n\n[pause=1] Welcome to NarrateAI, where your words come alive.';

function setStatus(message, kind='') { $('status').textContent=message; $('status').className='status '+kind; }
function busy(value) { states.working=value; for(const id of ['preview','generate','translate','extractFile','loadArticle','cloneButton']) $(id).disabled=value; $('progressContainer').classList.toggle('hidden',!value); if (!value) states.controller=null; }
function progress(n, total, label){ $('progressText').textContent=`${label} · ${n}/${total}`; $('progressBar').style.width= Math.round((n/total)*100)+'%'; }
function setTab(tab){
  for(const btn of document.querySelectorAll('.tab')) btn.classList.toggle('active',btn.dataset.tab===tab);
  for(const pane of ['paste','upload','url']) $(pane+'Pane').classList.toggle('hidden', pane!==tab);
}
function fillVoices(){
  const selected=$('speaker').value; const v4=$('model').value==='bulbul:v4-flash';
  $('speaker').replaceChildren();
  for (const [id,name] of v4?SPEAKERS_V4:SPEAKERS_V3){let op=document.createElement('option');op.value=id;op.textContent=name;$('speaker').append(op)}
  if([...$('speaker').options].some(o=>o.value===selected)) $('speaker').value=selected;
  $('temperature').disabled=v4;
  $('temperature').title=v4?'Bulbul v4 Flash does not use temperature for expressiveness. Choose a persona voice instead.':'';
}
function refresh(){
  $('count').textContent=$('content').value.length.toLocaleString()+' characters';
  $('paceValue').textContent=(+$('pace').value).toFixed(2)+'×';
  $('tempValue').textContent=(+$('temperature').value).toFixed(2);
  $('pauseValue').textContent=(+$('paragraphPause').value).toFixed(1)+'s';
}
function applyPreset(){
  const p=presets[$('preset').value];$('pace').value=p.pace;$('temperature').value=p.temperature;$('paragraphPause').value=p.pause;
  const language=$('language').value;
  const hiSpeakers={neutral:'aparna_hi_customer',news:'ritu_hi_customer',fiction:'ratan_hi_customer_expressive',education:'shubh_hi_customer'};
  const want=$('model').value==='bulbul:v4-flash'
    ? (language==='en-IN' ? (p.v4.includes('_hi_') ? 'simran_en_customer' : p.v4)
       : language==='hi-IN' ? hiSpeakers[$('preset').value] : '')
    : p.v3;
  if([...$('speaker').options].some(o=>o.value===want)) $('speaker').value=want;
  refresh();
}
function accessPassword(){
  const pwd=$('accessPassword').value.trim();
  if(!pwd) throw new Error('Enter your app access password (APP_ACCESS_PASSWORD on Vercel) first.');
  return pwd;
}
async function send(path,options={}){
  const headers={...(options.headers||{}),'x-app-password':accessPassword()};
  states.controller=new AbortController();
  let res;
  try{res=await fetch(path,{...options, headers,signal:states.controller.signal})}
  catch(err){if(err.name==='AbortError')throw new Error('Request cancelled.');throw new Error('Network request failed: '+err.message)}
  if(!res.ok){let reason='HTTP '+res.status;try{const data=await res.json();reason=typeof data.detail==='string'?data.detail:JSON.stringify(data.detail)}catch{};throw new Error(reason)}
  return res;
}
async function postJSON(path,data){const res=await send(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});return res.json()}
function splitByLimit(text,max){
  // Prefer sentence boundaries, then spaces; only split a long word when unavoidable.
  const result=[]; const sentences=text.trim().match(/[^.!?।॥]+[.!?।॥]*\s*|[\s\S]+/gu)||[];
  let current='';
  function flush(){if(current.trim())result.push(current.trim());current=''}
  function add(piece){piece=piece.trim();if(!piece)return; if(piece.length>max){flush();let start=0;while(start<piece.length){let end=Math.min(start+max,piece.length);if(end<piece.length){let breakAt=piece.lastIndexOf(' ',end);if(breakAt>start+max*0.5)end=breakAt;}result.push(piece.slice(start,end).trim());start=end;while(piece[start]===' ')start++;}return;}
    if(current && current.length+piece.length+1>max)flush();current+=(current?' ':'')+piece;
  }
  for(const s of sentences)add(s);flush();return result;
}
function planNarration(text,max=440,paragraphPause=0.4){
  text=text.replace(/\r\n/g,'\n').replace(/\[em\]([\s\S]*?)\[\/em\]/gi,(_,a)=>a.trim().replace(/[.!?]*$/,'!')).trim();
  const events=[];const chunks=text.split(/(\[pause(?:\s*=\s*\d+(?:\.\d+)?)?\]|\n\s*\n+)/gi);
  for(const chunk of chunks){
    if(!chunk)continue;
    if(/^\[pause/i.test(chunk)){
      const m=chunk.match(/\[pause(?:\s*=\s*(\d+(?:\.\d+)?))?\]/i);
      const secs=Math.min(5,Math.max(0,parseFloat(m?.[1]||'0.7')));
      if(events.length && events[events.length-1].type==='speech' && secs>0)events.push({type:'pause',secs});
    } else if(/^\n\s*\n/.test(chunk)){
      if(events.length && events[events.length-1].type==='speech'&&paragraphPause>0)events.push({type:'pause',secs:paragraphPause});
    } else for(const content of splitByLimit(chunk.replace(/\s+/g,' '),max))events.push({type:'speech',text:content});
  }
  while(events.at(-1)?.type==='pause')events.pop();return events;
}
function parseWav(buffer){
  const view=new DataView(buffer);const ascii=(i,n)=>String.fromCharCode(...new Uint8Array(buffer,i,n));
  if(buffer.byteLength<44||ascii(0,4)!=='RIFF'||ascii(8,4)!=='WAVE')throw new Error('Sarvam returned an unsupported audio container instead of WAV.');
  let fmt=null,pcm=null;
  for(let p=12;p+8<=buffer.byteLength;){const name=ascii(p,4),length=view.getUint32(p+4,true),begin=p+8;if(begin+length>buffer.byteLength)throw new Error('Malformed WAV clip');
    if(name==='fmt '){if(length<16)throw new Error('Unsupported WAV format');fmt={format:view.getUint16(begin,true),channels:view.getUint16(begin+2,true),rate:view.getUint32(begin+4,true),bits:view.getUint16(begin+14,true)};}
    if(name==='data')pcm=new Uint8Array(buffer,begin,length);
    p=begin+length+(length%2);
  }
  if(!fmt||!pcm||fmt.format!==1||fmt.bits!==16)throw new Error('Only standard 16-bit PCM WAV is supported by the browser merger.');
  return {fmt,pcm};
}
function joinWav(clips,events){
  if(!clips.length)throw new Error('No clips to assemble.');
  let first,clipIndex=0;const blocks=[];let byteLength=0;
  for(const e of events){
    if(e.type==='speech'){
      const {fmt,pcm}=parseWav(clips[clipIndex++]);
      if(!first)first=fmt;
      else if(first.rate!==fmt.rate||first.channels!==fmt.channels||first.bits!==fmt.bits)throw new Error('The API returned mixed sample formats. Try again.');
      blocks.push(pcm);byteLength+=pcm.length;
    }else if(first){const silence=new Uint8Array(Math.round(first.rate*e.secs)*first.channels*(first.bits/8));blocks.push(silence);byteLength+=silence.length;}
  }
  if(byteLength>0xfffffff0)throw new Error('Narration is too long for a WAV file.');
  const out=new Uint8Array(byteLength+44);const dv=new DataView(out.buffer);const write=(pos,value)=>{for(let i=0;i<value.length;i++)out[pos+i]=value.charCodeAt(i)};
  write(0,'RIFF');dv.setUint32(4,36+byteLength,true);write(8,'WAVE');write(12,'fmt ');dv.setUint32(16,16,true);dv.setUint16(20,1,true);dv.setUint16(22,first.channels,true);dv.setUint32(24,first.rate,true);dv.setUint32(28,first.rate*first.channels*2,true);dv.setUint16(32,first.channels*2,true);dv.setUint16(34,16,true);write(36,'data');dv.setUint32(40,byteLength,true);
  let offset=44;for(const block of blocks){out.set(block,offset);offset+=block.length}
  return {blob:new Blob([out],{type:'audio/wav'}),duration:byteLength/(first.rate*first.channels*2)};
}
function showAudio(blob,duration,preview=false){
  if(states.url) URL.revokeObjectURL(states.url);
  states.url=URL.createObjectURL(blob);$('audio').src=states.url;$('download').href=states.url;
  $('download').download=preview?'narrateai-preview.wav':'narrateai-narration.wav';
  $('duration').textContent=`${Math.floor(duration/60)}m ${Math.round(duration%60)}s · WAV`;
  $('result').classList.remove('hidden');
}
async function runNarration(preview){
  if(states.working)return;
  const text=$('content').value.trim();
  if(!text){setStatus('Paste content or import a document first.','error');setTab('paste');return;}
  if(text.length>25000){setStatus('For browser memory safety, limit each narration to 25,000 characters. Split a larger document into chapters.','error');return;}
  const p=+$('paragraphPause').value;
  const events=planNarration(preview?text.slice(0,240):text,440,p);
  const speech=events.filter(e=>e.type==='speech');
  if(speech.length>110){setStatus('Too many audio segments. Split your document into chapters.','error');return;}
  let clips=[];
  try{
    busy(true);progress(0,speech.length,preview?'Generating preview':'Generating audio');setStatus(`Generating ${speech.length} segment${speech.length===1?'':'s'}…`);
    for(let i=0;i<speech.length;i++){
      const request={text:speech[i].text,language:$('language').value,model:$('model').value,
        speaker:$('speaker').value||null,pace:+$('pace').value,temperature:+$('temperature').value,
        voice_id:$('voiceId').value.trim()||null};
      const response=await send('/api/speech',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
      clips.push(await response.arrayBuffer());progress(i+1,speech.length,'Generating audio');
    }
    const output=joinWav(clips,events);showAudio(output.blob,output.duration,preview);setStatus('Narration generated! Play it here or download the WAV file.','ok');
  }catch(err){setStatus(err.message,'error');}finally{busy(false)}
}
async function importFile(){
  const file=$('file').files[0];if(!file){setStatus('Choose a file first.','error');return;}
  if(file.size>4*1024*1024){setStatus('Vercel limits uploads through Functions to 4.5 MB. Please upload a file smaller than 4 MB.','error');return;}
  try{busy(true);setStatus('Extracting document…');const fd=new FormData();fd.append('file',file);const r=await send('/api/extract',{method:'POST',body:fd});const data=await r.json();$('content').value=data.text;refresh();setTab('paste');setStatus(`Extracted ${data.text.length.toLocaleString()} characters from ${file.name}.`,'ok');}catch(err){setStatus(err.message,'error');}finally{busy(false)}
}
async function importArticle(){
  try{busy(true);setStatus('Fetching article…');const data=await postJSON('/api/article',{url:$('articleUrl').value});$('content').value=data.text;refresh();setTab('paste');setStatus(`Imported ${data.text.length.toLocaleString()} characters.`,'ok');}catch(err){setStatus(err.message,'error');}finally{busy(false)}
}
async function translate(){
  const text=$('content').value.trim();if(!text){setStatus('Add some content before translating.','error');return;}
  const source=$('sourceLanguage').value, target=$('targetLanguage').value;
  if(source===target){setStatus('Select a different target language.','error');return;}
  // Preserve paragraphs for pauses in the narration that follows.
  const paragraphs=text.split(/\n\s*\n/).flatMap(par=>splitByLimit(par,1500));
  try{busy(true);progress(0,paragraphs.length,'Translating');const out=[];
    for(let i=0;i<paragraphs.length;i++){
      const r=await postJSON('/api/translate',{text:paragraphs[i],source,target});out.push(r.text);
      progress(i+1,paragraphs.length,'Translating');
    }
    $('content').value=out.join('\n\n');$('language').value=target;refresh();setTab('paste');setStatus('Translation complete! Review the text, then generate narration.','ok');
  }catch(err){setStatus(err.message,'error');}finally{busy(false)}
}
async function createVoice(){
  const f=$('cloneFile').files[0];if(!f){setStatus('Choose a reference audio clip.','error');return;}
  if(f.size>4*1024*1024){setStatus('Reference audio must be under 4 MB for Vercel uploads.','error');return;}
  try{
    busy(true);setStatus('Creating cloned voice…');const fd=new FormData();fd.append('file',f);fd.append('name',$('cloneName').value);fd.append('language',$('language').value);fd.append('style',$('cloneStyle').value);fd.append('consent',String($('cloneConsent').checked));
    const res=await send('/api/voices/create',{method:'POST',body:fd});const data=await res.json();$('voiceId').value=data.voice_id;
    setStatus(`Voice created. Save your voice ID for later: ${data.voice_id}`,'ok');
  }catch(err){setStatus(err.message,'error');}finally{busy(false)}
}
for(const btn of document.querySelectorAll('.tab'))btn.addEventListener('click',()=>setTab(btn.dataset.tab));
$('content').addEventListener('input',refresh);
for(const id of ['pace','temperature','paragraphPause'])$(id).addEventListener('input',refresh);
$('preset').addEventListener('change',applyPreset);
$('model').addEventListener('change',()=>{fillVoices();applyPreset()});
$('language').addEventListener('change',()=>{
  if(['ml-IN','od-IN'].includes($('language').value)&&$('model').value==='bulbul:v4-flash'){
    $('model').value='bulbul:v3';fillVoices();applyPreset();setStatus('Bulbul v3 selected: v4 Flash currently has no dedicated Malayalam or Odia personas.');
  }
  applyPreset();
});
$('fillSample').addEventListener('click',()=>{$('content').value=sample;setTab('paste');refresh();setStatus('Sample loaded. Pick a voice and generate a quick preview.');});
$('preview').addEventListener('click',()=>runNarration(true));
$('generate').addEventListener('click',()=>runNarration(false));
$('extractFile').addEventListener('click',importFile);
$('loadArticle').addEventListener('click',importArticle);
$('translate').addEventListener('click',translate);
$('cloneButton').addEventListener('click',createVoice);
$('cancel').addEventListener('click',()=>{states.controller?.abort();setStatus('Request cancelled.','error');});
$('accessPassword').addEventListener('change',()=>sessionStorage.setItem('narrateai-password',$('accessPassword').value));
$('accessPassword').value=sessionStorage.getItem('narrateai-password')||'';
fillVoices();applyPreset();refresh();
fetch('/api/health').then(r=>r.json()).then(d=>{
  const indicator=$('serverState');indicator.textContent=d.api_key_configured&&d.access_password_configured?'API configured':'Server setup needed';indicator.classList.toggle('good',d.api_key_configured&&d.access_password_configured);
  let dot=document.createElement('span');dot.className='dot';indicator.prepend(dot);
  if(!d.api_key_configured||!d.access_password_configured)setStatus('Deployment setup needed: add SARVAM_API_KEY and APP_ACCESS_PASSWORD to Vercel environment variables.','error');
}).catch(()=>{const indicator=$('serverState');indicator.textContent='API unavailable';});
