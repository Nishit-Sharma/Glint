import {BotImage,characterStill,CharacterAdornment} from './bot-art';
import {createContext,useCallback,useContext,useEffect,useId,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {ChevronDown} from 'lucide-react';
import {CHARACTER_SHAPES,CHARACTER_PICKER_SHAPES,CHARACTER_COLORS,CHARACTER_FACES,DEFAULT_CHARACTER,characterLabel,readCharacterState,readCharacterCommit,sameCharacter,type CharacterProfile,type CharacterSnapshot,type CharacterState,type CharacterCommit} from '../../shared/character-catalog';
import {useNavigationDraft} from './draft-navigation';
import {mountOriginal,type OriginalActor} from './character-original/actor-runtime.js';
import {fallbackMotion} from './thumbnail-motion';
import shapeAssets from './character-original/shape-assets.json';
import type {SourceDragState} from '../../shared/source-drag';
import './character.css';

type Surface='workspace'|'companion'|'anchor';
type Slot='sidebar'|'header'|'companion'|'anchor';
type Phase='ready'|'working';
type Session={identityHeader:boolean;profile:CharacterProfile;state:CharacterState|{kind:'loading'};narrow:boolean;register:(slot:Slot,node:HTMLSpanElement|null)=>void;preview:(node:HTMLSpanElement|null)=>void;previewLook:(look:CharacterProfile['look']|undefined)=>void;commit:(base:CharacterSnapshot,profile:CharacterProfile)=>Promise<CharacterCommit>;reload:()=>Promise<CharacterState>;failed:boolean;retry:()=>void};
const Context=createContext<Session|null>(null);
const lightAccents:Record<CharacterProfile['look']['color'],string>={dough:'#826038',iris:'#5667a4',sage:'#3e7058',apricot:'#965b40',rose:'#94536a',sky:'#416e92',butter:'#7b681d'};
function useCharacter(){const session=useContext(Context);if(!session)throw Error('Character session is unavailable.');return session;}
function useNarrow(){const [narrow,setNarrow]=useState(()=>matchMedia('(max-width:799px)').matches);useLayoutEffect(()=>{const media=matchMedia('(max-width:799px)'),change=()=>setNarrow(media.matches);media.addEventListener('change',change);change();return()=>media.removeEventListener('change',change);},[]);return narrow;}
function useActorLease(element:HTMLSpanElement|null,look:CharacterProfile['look'],retry:number,onFailure:(failed:boolean)=>void,phase:Phase='ready'){
 const actor=useRef<OriginalActor|undefined>(undefined),appliedPhase=useRef<Phase>('ready'),leaseImage=useRef<HTMLImageElement|undefined>(undefined),fallbackImage=useRef<HTMLImageElement|undefined>(undefined),releaseFallback=useRef<(()=>void)|undefined>(undefined),currentMotion=useRef(look.motion);currentMotion.current=look.motion;
 useLayoutEffect(()=>{
  if(!element)return;const bounds=element.getBoundingClientRect();if(!bounds.width||!bounds.height)return;
  const image=document.createElement('img');try{image.src=characterStill(look);}catch{image.src=shapeAssets[look.shape];}image.alt='';image.draggable=false;leaseImage.current=image;
  const canvas=document.createElement('canvas');canvas.setAttribute('aria-hidden','true');
  element.replaceChildren(image,canvas);element.dataset.characterRender='live';let disposed=false,failed=false;
  const owner=element.closest('button'),acknowledge=()=>actor.current?.acknowledge();
  const fallback=()=>{if(disposed||failed)return;failed=true;canvas.remove();element.dataset.characterRender='static';fallbackImage.current=image;releaseFallback.current=fallbackMotion(image,currentMotion.current,element.offsetWidth*37+look.shape.charCodeAt(0));onFailure(true);};
  try{actor.current=mountOriginal(canvas,look,fallback);appliedPhase.current='ready';if(!failed)onFailure(false);}catch{fallback();}
  owner?.addEventListener('pointerenter',acknowledge);owner?.addEventListener('focus',acknowledge);
  return()=>{if(disposed)return;disposed=true;owner?.removeEventListener('pointerenter',acknowledge);owner?.removeEventListener('focus',acknowledge);releaseFallback.current?.();releaseFallback.current=undefined;fallbackImage.current=undefined;leaseImage.current=undefined;actor.current?.destroy();actor.current=undefined;element.replaceChildren();delete element.dataset.characterRender;};
 },[element,look.shape,look.face,retry,onFailure]);
 useLayoutEffect(()=>{actor.current?.setColor(look.color);if(leaseImage.current){try{leaseImage.current.src=characterStill(look);}catch{leaseImage.current.src=shapeAssets[look.shape];}}},[element,look.shape,look.face,look.color,retry]);
 useLayoutEffect(()=>{if(look.motion)actor.current?.resume();else actor.current?.pause();if(fallbackImage.current){releaseFallback.current?.();releaseFallback.current=fallbackMotion(fallbackImage.current,look.motion,look.shape.charCodeAt(0)*41);}},[element,look.shape,look.face,look.motion,retry]);
 useLayoutEffect(()=>{if(actor.current&&appliedPhase.current!==phase){actor.current.setPhase(phase);appliedPhase.current=phase;}},[element,look.shape,look.face,retry,phase]);
}
export function CharacterProvider({surface,working,children,identity,suspended=false}:{surface:Surface;working:boolean;children:ReactNode;suspended?:boolean;identity?:{snapshot:CharacterSnapshot;commit:(base:CharacterSnapshot,profile:CharacterProfile)=>Promise<CharacterCommit>;reload:()=>Promise<CharacterState>}}){
 const [storedState,setState]=useState<Session['state']>({kind:'loading'}),[storedProfile,setProfile]=useState(DEFAULT_CHARACTER),[slots,setSlots]=useState<Partial<Record<Slot,HTMLSpanElement>>>({}),[preview,setPreview]=useState<HTMLSpanElement|null>(null),[previewLook,setPreviewLook]=useState<CharacterProfile['look']>(),[mainFailed,setMainFailed]=useState(false),[previewFailed,setPreviewFailed]=useState(false),[retry,setRetry]=useState(0);
 const profile=identity?.snapshot.profile??storedProfile,state:Session['state']=identity?{kind:'available',current:identity.snapshot}:storedState;
 const narrow=useNarrow(),register=useCallback((slot:Slot,node:HTMLSpanElement|null)=>setSlots(previous=>{if(previous[slot]===(node??undefined))return previous;return {...previous,[slot]:node??undefined};}),[]);
 useLayoutEffect(()=>{
  const style=document.documentElement.style,color=CHARACTER_COLORS.find(color=>color.id===profile.look.color)!.hex;
  const values={'--accent':color,'--focus':color,'--character-reveal-light':lightAccents[profile.look.color],'--gen-line':'var(--character-reveal)','--gen-strong':'var(--character-reveal)','--tig-line':'var(--character-reveal)','--tig-strong':'var(--character-reveal)'};
  const previous=Object.keys(values).map(key=>[key,style.getPropertyValue(key),style.getPropertyPriority(key)] as const);
  for(const [key,value] of Object.entries(values))style.setProperty(key,value);
  return()=>{for(const [key,value,priority] of previous)if(value)style.setProperty(key,value,priority);else style.removeProperty(key);};
 },[profile.look.color]);
 const reload=useCallback(async()=>{if(identity)return identity.reload();const result=readCharacterState(await window.companion.invoke({type:'preferences.get'}));setState(result);if(result.kind==='available')setProfile(result.current.profile);return result;},[identity]);
 useEffect(()=>{if(identity||suspended)return;let alive=true;void window.companion.invoke({type:'preferences.get'}).then(readCharacterState).then(result=>{if(!alive)return;setState(result);if(result.kind==='available')setProfile(result.current.profile);}).catch(()=>{if(alive)setState({kind:'unavailable',message:'Your saved appearance could not be opened. It has not been changed.'});});return()=>{alive=false;};},[]);
 const commit=useCallback(async(base:CharacterSnapshot,submitted:CharacterProfile):Promise<CharacterCommit>=>{
  if(identity)return identity.commit(base,submitted);
  let result:CharacterCommit;
  try{result=readCharacterCommit(await window.companion.invoke({type:'preferences.update',expectedRevision:base.revision,profile:submitted}));}
  catch(error){
   const observed=await reload();
   if(observed.kind==='unavailable')return observed;
   if(observed.current.revision===base.revision+1&&sameCharacter(observed.current.profile,submitted))result={kind:'saved',current:observed.current};
   else if(observed.current.revision!==base.revision)result={kind:'conflict',current:observed.current};
   else throw error;
  }
  if(result.kind==='saved'){setState({kind:'available',current:result.current});setProfile(result.current.profile);}
  else if(result.kind==='unavailable')setState(result);
  return result;
 },[reload,identity]);
 const slot=surface==='workspace'?(identity?'header':narrow?'header':'sidebar'):surface;
 useActorLease(suspended?null:slots[slot]??null,profile.look,retry,setMainFailed,working?'working':'ready');
 useActorLease(surface==='workspace'&&!suspended?preview:null,previewLook??profile.look,retry,setPreviewFailed);
 return <Context.Provider value={{identityHeader:!!identity,profile,state,narrow,register,preview:setPreview,previewLook:setPreviewLook,commit,reload,failed:mainFailed||!!preview&&previewFailed,retry:()=>setRetry(value=>value+1)}}>{children}</Context.Provider>;
}
export function CharacterControl({place,onOpen}:{place:'sidebar'|'header'|'companion';onOpen:()=>void}){
 const session=useCharacter(),ref=useCallback((node:HTMLSpanElement|null)=>session.register(place,node),[session.register,place]);
 if(place==='sidebar'&&session.narrow||place==='header'&&!session.narrow&&!session.identityHeader)return null;
 const label=characterLabel(session.profile);
 return <button type="button" className={'character-control character-control-'+place} aria-label={'Customize '+label} title={label+' · '+CHARACTER_SHAPES.find(shape=>shape.id===session.profile.look.shape)?.label} onClick={onOpen}><span className="character-portrait"><span ref={ref} className="character-slot" data-t-generate-skip aria-hidden="true"/><CharacterAdornment look={session.profile.look}/></span>{place==='sidebar'&&<><strong>{label}</strong><ChevronDown size={12}/></>}</button>;
}
export function CharacterAnchor({onOpen,onChooseWindow}:{onOpen:()=>void;onChooseWindow:()=>void}){
 const session=useCharacter(),ref=useCallback((node:HTMLSpanElement|null)=>session.register('anchor',node),[session.register]);
 const [drag,setDrag]=useState<SourceDragState>({kind:'idle'}),description=useId(),start=useRef<{x:number;y:number}|undefined>(undefined),moved=useRef(false);
 const cancel=()=>{start.current=undefined;moved.current=true;void window.companion.invoke({type:'source.drag.cancel'}).catch(()=>{});};
 useEffect(()=>window.companion.subscribe(event=>{if(event.type==='source.drag'){setDrag(event.state);if(event.state.kind==='idle')start.current=undefined;else moved.current=true;}}),[]);
 const message=drag.kind==='target'?`Release to attach and capture one local snapshot of ${drag.title||'Untitled window'} in ${drag.ownerName}. Nothing is sent or followed automatically. Escape cancels.`:drag.kind==='blocked'?drag.message:drag.kind==='searching'?'Choose a source window. Escape cancels.':'';
 return <button type="button" className="anchor" data-source-drag={drag.kind} aria-label="Open Glint" aria-describedby={description} title={'Open '+characterLabel(session.profile)+' · Drag onto a window to capture one local snapshot, or press Down Arrow to choose one'}
  onPointerDown={event=>{if(event.isPrimary&&event.button===0){start.current={x:event.clientX,y:event.clientY};moved.current=false;event.currentTarget.setPointerCapture(event.pointerId);}}}
  onPointerMove={event=>{if(start.current&&Math.hypot(event.clientX-start.current.x,event.clientY-start.current.y)>=6)moved.current=true;}}
  onPointerUp={()=>{start.current=undefined;}} onPointerCancel={cancel} onLostPointerCapture={event=>{if(event.buttons!==0)cancel();}}
  onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();cancel();}if(event.key==='ArrowDown'){event.preventDefault();onChooseWindow();}}}
  onContextMenu={event=>{event.preventDefault();onChooseWindow();}}
  onClick={event=>{if(event.detail!==0&&moved.current){event.preventDefault();moved.current=false;return;}onOpen();}}>
  <span className="character-portrait"><span ref={ref} className="character-slot" data-t-generate-skip aria-hidden="true"/><CharacterAdornment look={session.profile.look}/></span><span className="sr-only" id={description}>Drag onto a source window to attach and capture one local snapshot. Nothing is sent or followed automatically. Press Down Arrow to choose a window with the keyboard.</span><span className="sr-only" role="status">{message}</span>
 </button>;
}
export function AppearanceEditor({onCancel,heading=true}:{onCancel:()=>void;heading?:boolean}){
 const session=useCharacter();
 if(session.state.kind==='loading')return <p role="status">Opening your appearance…</p>;
 if(session.state.kind==='unavailable')return <section className="appearance-unavailable"><h3>Your appearance is unavailable</h3><p role="alert">{session.state.message}</p><button type="button" onClick={()=>void session.reload().catch(()=>{})}>Try opening it again</button></section>;
 return <AppearanceForm heading={heading} initial={session.state.current} onCancel={onCancel}/>;
}
function AppearanceForm({initial,onCancel,heading}:{initial:CharacterSnapshot;onCancel:()=>void;heading:boolean}){
 const session=useCharacter(),[base,setBase]=useState(initial),[value,setValue]=useState(initial.profile),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[conflict,setConflict]=useState<CharacterSnapshot>(),lock=useRef(false),mounted=useRef(true);
 const dirty=!sameCharacter(base.profile,value),clearDraft=useNavigationDraft(dirty||saving);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useLayoutEffect(()=>{session.previewLook(value.look);return()=>session.previewLook(undefined);},[session.previewLook,value.look]);
 const previewRef=useCallback((node:HTMLSpanElement|null)=>session.preview(node),[session.preview]);
 const name=value.personalName??'',nameInvalid=[...name].length>40||/[\p{Cc}\p{Cf}]/u.test(name);
 const patch=(change:Partial<CharacterProfile>)=>{setMessage('');setValue(previous=>({...previous,...change}));};
 async function save(){
  if(lock.current||!dirty||nameInvalid||conflict)return;lock.current=true;setSaving(true);setMessage('');
  const submitted={...value,personalName:name.normalize('NFC').trim()||null};
  try{const result=await session.commit(base,submitted);if(!mounted.current)return;if(result.kind==='saved'){setBase(result.current);setValue(result.current.profile);clearDraft();setMessage('Appearance saved.');}else if(result.kind==='conflict'){setConflict(result.current);setMessage('Your saved appearance changed elsewhere. Your edits have not been saved.');}else setMessage(result.message);}
  catch{if(mounted.current)setMessage('Your appearance could not be saved. Your edits are still here. Try Save again.');}
  finally{lock.current=false;if(mounted.current)setSaving(false);}
 }
 const choices=(items:readonly typeof CHARACTER_SHAPES[number][])=>items.map(shape=><button type="button" key={shape.id} aria-pressed={value.look.shape===shape.id} disabled={saving} onClick={()=>patch({look:{...value.look,shape:shape.id}})}><BotImage profile={{...value,look:{...value.look,shape:shape.id}}}/>{shape.label}</button>);
 return <form className="appearance-editor" onSubmit={event=>{event.preventDefault();void save();}} aria-label="Character appearance">
  {heading&&<h3>Make it yours</h3>}
  <div className="appearance-layout"><div className="appearance-preview-column"><div className="appearance-preview"><span className="character-portrait"><span ref={previewRef} className="character-slot" data-t-generate-skip aria-hidden="true"/><CharacterAdornment look={value.look}/></span><span className="sr-only">Preview of your selected character</span></div>   <label className="appearance-name">Name <span>Optional</span><input aria-label="Character name" value={name} placeholder="Companion" disabled={saving} maxLength={80} aria-invalid={nameInvalid} aria-describedby="character-name-help" onChange={event=>patch({personalName:event.target.value||null})}/></label><p id="character-name-help" className={nameInvalid?'warning':'tiny'}>{nameInvalid?'Use up to 40 characters without control characters.':'Leave blank to use Companion.'}</p></div>
  <div className="appearance-controls">

   <fieldset disabled={saving}><legend>Shape</legend><div className="character-shapes">{choices(CHARACTER_PICKER_SHAPES.slice(0,6))}</div><details className="character-more" open={CHARACTER_PICKER_SHAPES.slice(6).some(shape=>shape.id===value.look.shape)||undefined}><summary>{CHARACTER_PICKER_SHAPES.length-6} more shapes</summary><div className="character-shapes">{choices(CHARACTER_PICKER_SHAPES.slice(6))}</div></details></fieldset>
   <fieldset disabled={saving}><legend>Color</legend><div className="character-swatches">{CHARACTER_COLORS.map(color=><button type="button" key={color.id} title={color.label} aria-label={color.label} aria-pressed={value.look.color===color.id} style={{backgroundColor:color.hex}} onClick={()=>patch({look:{...value.look,color:color.id}})}/>)}</div></fieldset>
   <fieldset disabled={saving}><legend>Face</legend><div className="character-faces">{CHARACTER_FACES.map(face=><button type="button" key={face.id} aria-pressed={value.look.face===face.id} onClick={()=>patch({look:{...value.look,face:face.id}})}>{face.label}</button>)}</div></fieldset>
   <fieldset disabled={saving}><legend>Glasses</legend><div className="character-faces">{(['none','round'] as const).map(glasses=><button type="button" key={glasses} aria-pressed={(value.look.glasses??'none')===glasses} onClick={()=>patch({look:{...value.look,glasses}})}>{glasses==='none'?'No glasses':'Round glasses'}</button>)}</div></fieldset>
   <fieldset disabled={saving}><legend>Accessory</legend><div className="character-faces">{(['none','scarf'] as const).map(accessory=><button type="button" key={accessory} aria-pressed={(value.look.accessory??'none')===accessory} onClick={()=>patch({look:{...value.look,accessory}})}>{accessory==='none'?'No accessory':'Scarf'}</button>)}</div></fieldset>
   <label className="character-movement"><input type="checkbox" checked={value.look.motion} disabled={saving} onChange={event=>patch({look:{...value.look,motion:event.target.checked}})}/><span>Subtle movement<small>Follows your pointer nearby. Respects reduced motion.</small></span></label>
  </div></div>
  {session.failed&&<p className="character-static-note" role="status">Using the original character artwork. <button type="button" onClick={session.retry}>Try 3D again</button></p>}
  {message&&<p className="appearance-message" role={conflict?'alert':'status'}>{message}</p>}
  {conflict&&<button type="button" disabled={saving} onClick={()=>{setSaving(true);void session.reload().then(current=>{if(!mounted.current||current.kind!=='available')return;setBase(current.current);setValue(current.current.profile);setConflict(undefined);setMessage('Saved appearance loaded.');clearDraft();}).catch(()=>{if(mounted.current)setMessage('Your saved appearance could not be opened. Your edits are still here.');}).finally(()=>{if(mounted.current)setSaving(false);});}}>Load saved appearance</button>}
  <div className="appearance-actions"><button type="submit" className="primary" disabled={saving||!dirty||nameInvalid||!!conflict}>{saving?'Saving…':'Save appearance'}</button><button type="button" disabled={saving} onClick={()=>{clearDraft();onCancel();}}>Cancel</button></div>
 </form>;
}
