import {expect,test,type Locator,type Page,type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {settleCapture} from './settled-capture';

type Phase='before-nearest'|'after-nearest'|'after-center'|'final-gates';
type Rect={x:number;y:number;left:number;top:number;right:number;bottom:number;width:number;height:number};
type NodeGeometry={index:number;tag:string;rect:Rect;client:{left:number;top:number;width:number;height:number};scroll:{left:number;top:number;width:number;height:number};border:{left:number;top:number;right:number;bottom:number};css:{overflowX:string;overflowY:string;position:string;transform:string;borderRadius:string;clipPath:string;contain:string}};
type Measurement={phase:Phase;times:{started:number;rectsRead:number;ioEntry:number;finished:number};viewport:{width:number;height:number;devicePixelRatio:number};target:NodeGeometry;ancestors:NodeGeometry[];intersection:{ratio:number;isIntersecting:boolean;bounding:Rect;intersection:Rect;root:Rect|null};numeric:{fits:boolean;rect:Rect;clip:{left:number;top:number;right:number;bottom:number};viewport:{width:number;height:number}}};
type FailedGate='viewport-ratio-1'|'numeric-ancestor-clip';
type FrameRecord={name:string;verdict:'pending'|'qualified'|'unqualified';failedGates:FailedGate[];measurementFile?:string;qualificationFile?:string;imageFile?:string};
const frames=new Map<string,FrameRecord[]>();
const MAX_FRAMES=5,MAX_ANCESTORS=64,MAX_JSON_BYTES=1024*1024,IO_TIMEOUT_MS=2000;

async function jsonFile(info:TestInfo,name:string,data:unknown){
 const text=JSON.stringify(data,null,2)+'\n';
 if(Buffer.byteLength(text)>MAX_JSON_BYTES)throw Error('Frame diagnostic exceeds its fixed output bound.');
 const path=info.outputPath(name);await writeFile(path,text,{flag:'wx'});await info.attach(name,{path,contentType:'application/json'});return name;
}
async function ownPage(page:Page,anchor:Locator){
 if(page.isClosed())throw Error('Owned frame page closed.');
 await expect(anchor).toHaveCount(1);
 await expect(page.locator('[data-runtime-scope="whole-surface"]:visible')).toHaveCount(1);
 await anchor.evaluate(element=>{
  if(location.origin!=='http://127.0.0.1:4180'||location.pathname!=='/'||!element.isConnected||!element.closest('[data-runtime-scope="whole-surface"]'))throw Error('Frame target left the owned App page.');
 });
}
function numericRatioRefusal(error:unknown):boolean{
 if(!(error instanceof Error)||!('matcherResult' in error))return false;
 const result=error.matcherResult;
 if(typeof result!=='object'||result===null||!('name' in result)||result.name!=='toBeInViewport'||!('pass' in result)||result.pass!==false||!('expected' in result)||result.expected!=='in viewport'||!('actual' in result)||typeof result.actual!=='string')return false;
 const match=/^viewport ratio ((?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)$/i.exec(result.actual);
 if(!match)return false;const ratio=Number(match[1]);return Number.isFinite(ratio)&&ratio>=0&&ratio<1;
}
async function measure(anchor:Locator,phase:Phase):Promise<Measurement>{
 return anchor.evaluate(async(element,options)=>{
  const started=performance.now();
  if(!(element instanceof HTMLElement)||!element.isConnected||location.origin!=='http://127.0.0.1:4180'||location.pathname!=='/')throw Error('Cannot measure the owned frame target.');
  const finite=(value:number)=>{if(!Number.isFinite(value))throw Error('Nonfinite frame geometry.');return value;};
  const rect=(value:DOMRectReadOnly):Rect=>({x:finite(value.x),y:finite(value.y),left:finite(value.left),top:finite(value.top),right:finite(value.right),bottom:finite(value.bottom),width:finite(value.width),height:finite(value.height)});
  const cssText=(value:string,max=64)=>{if(value.length>max||/url\s*\(/i.test(value))throw Error('Unsupported diagnostic CSS value.');return value;};
  const border=(value:string)=>{const parsed=Number.parseFloat(value);if(!Number.isFinite(parsed))throw Error('Unsupported diagnostic border.');return parsed;};
  const geometry=(node:HTMLElement,index:number):NodeGeometry=>{
   const style=getComputedStyle(node);
   return {index,tag:cssText(node.tagName,32),rect:rect(node.getBoundingClientRect()),client:{left:finite(node.clientLeft),top:finite(node.clientTop),width:finite(node.clientWidth),height:finite(node.clientHeight)},scroll:{left:finite(node.scrollLeft),top:finite(node.scrollTop),width:finite(node.scrollWidth),height:finite(node.scrollHeight)},border:{left:border(style.borderLeftWidth),top:border(style.borderTopWidth),right:border(style.borderRightWidth),bottom:border(style.borderBottomWidth)},css:{overflowX:cssText(style.overflowX),overflowY:cssText(style.overflowY),position:cssText(style.position),transform:cssText(style.transform,512),borderRadius:cssText(style.borderRadius,128),clipPath:cssText(style.clipPath,512),contain:cssText(style.contain,128)}};
  };
  const target=geometry(element,-1),ancestors:NodeGeometry[]=[];
  let left=0,top=0,right=innerWidth,bottom=innerHeight;
  for(let parent=element.parentElement;parent;parent=parent.parentElement){
   if(ancestors.length>=options.maxAncestors)throw Error('Frame ancestry exceeds its fixed diagnostic bound.');
   const value=geometry(parent,ancestors.length);ancestors.push(value);
   // The original strict numeric ancestor-clip predicate is unchanged.
   if(/auto|scroll|hidden|clip/.test(value.css.overflowX)){left=Math.max(left,value.rect.left+value.client.left);right=Math.min(right,value.rect.left+value.client.left+value.client.width);}
   if(/auto|scroll|hidden|clip/.test(value.css.overflowY)){top=Math.max(top,value.rect.top+value.client.top);bottom=Math.min(bottom,value.rect.top+value.client.top+value.client.height);}
  }
  const rectsRead=performance.now(),viewport={width:finite(innerWidth),height:finite(innerHeight),devicePixelRatio:finite(devicePixelRatio)};
  const intersection=await new Promise<{ratio:number;isIntersecting:boolean;bounding:Rect;intersection:Rect;root:Rect|null;time:number}>((resolve,reject)=>{
   const observer=new IntersectionObserver(entries=>{
    window.clearTimeout(timer);observer.disconnect();
    try{const entry=entries[0];if(!entry)throw Error('No frame intersection entry.');const ratio=finite(entry.intersectionRatio);if(ratio<0||ratio>1)throw Error('Invalid frame intersection ratio.');resolve({ratio,isIntersecting:entry.isIntersecting,bounding:rect(entry.boundingClientRect),intersection:rect(entry.intersectionRect),root:entry.rootBounds?rect(entry.rootBounds):null,time:finite(entry.time)});}catch(error){reject(error);}
   });
   const timer=window.setTimeout(()=>{observer.disconnect();reject(Error('Owned frame intersection measurement timed out.'));},options.ioTimeout);
   try{observer.observe(element);}catch(error){window.clearTimeout(timer);observer.disconnect();reject(error);}
  });
  const {time:ioEntry,...observed}=intersection,r=target.rect;
  return {phase:options.phase,times:{started,rectsRead,ioEntry,finished:performance.now()},viewport,target,ancestors,intersection:observed,numeric:{fits:r.left>=left&&r.right<=right&&r.top>=top&&r.bottom<=bottom,rect:r,clip:{left,top,right,bottom},viewport:{width:viewport.width,height:viewport.height}}};
 },{phase,maxAncestors:MAX_ANCESTORS,ioTimeout:IO_TIMEOUT_MS});
}

/** Four distinct serial observations; no historical geometry or simultaneous
 * DOM/IO measurements claimed. One normal nearest and one center scroll. */
export async function capacityFrame(page:Page,anchor:Locator,name:string){
 const info=test.info();
 if(!/^[a-z0-9][a-z0-9-]{0,99}$/.test(name))throw Error('Invalid diagnostic frame name.');
 const records=frames.get(info.testId)??[];
 if(records.length>=MAX_FRAMES||records.some(record=>record.name===name))throw Error('Duplicate frame or fixed per-case frame bound exceeded.');
 const record:FrameRecord={name,verdict:'pending',failedGates:[]};records.push(record);frames.set(info.testId,records);
 const viewport=page.viewportSize();expect(viewport).not.toBeNull();expect([[1080,800],[360,640]]).toContainEqual([viewport!.width,viewport!.height]);
 await ownPage(page,anchor);await settleCapture(page);await expect(anchor).toBeVisible();
 const beforeNearest=await measure(anchor,'before-nearest');
 await anchor.evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'}));
 const afterNearest=await measure(anchor,'after-nearest');
 await anchor.evaluate(element=>element.scrollIntoView({block:'center',inline:'center',behavior:'auto'}));
 const afterCenter=await measure(anchor,'after-center');
 record.measurementFile=await jsonFile(info,name+'.measurements-before-gates.json',{schemaVersion:1,kind:'viewport-observations',name,measurementScope:'Serial DOM/client reads paired with subsequent IO entries; not simultaneous or historical App02 measurements.',measurements:[beforeNearest,afterNearest,afterCenter]});
 try{await expect(anchor).toBeInViewport({ratio:1});}catch(error){
  // Only the actual numeric-ratio matcher refusal is deferred. Other errors
  // (missing locator, page/protocol/RPC and programmer errors) still throw.
  if(!numericRatioRefusal(error))throw error;
  await ownPage(page,anchor);await expect(anchor).toBeVisible();record.failedGates.push('viewport-ratio-1');
 }
 // Authentic readiness and the original ancestor-opacity guard remain hard.
 await expect.poll(()=>anchor.evaluate(element=>{for(let current:Element|null=element;current;current=current.parentElement){const style=getComputedStyle(current);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)<.99)return false;}return true;})).toBe(true);await settleCapture(page);
 const final=await measure(anchor,'final-gates');
 if(!final.numeric.fits)record.failedGates.push('numeric-ancestor-clip');
 await ownPage(page,anchor);await expect(anchor).toBeVisible();
 const qualified=record.failedGates.length===0,imageFile=name+(qualified?'.png':'.UNQUALIFIED.png');
 record.qualificationFile=await jsonFile(info,name+'.qualification.json',{schemaVersion:1,kind:'viewport-qualification',name,verdict:qualified?'qualified':'UNQUALIFIED',strictFailedGates:record.failedGates,criteria:{viewportRatio:1,ancestorOpacity:.99,numericClip:'Original strict >=left <=right >=top <=bottom predicate; no tolerance'},observations:[beforeNearest,afterNearest,afterCenter,final],historicalScope:'Current own-page measurements only; no historical App02 cause inferred.'});
 const path=info.outputPath(imageFile);await page.screenshot({path,fullPage:false});await info.attach(qualified?name:name+'-UNQUALIFIED',{path,contentType:'image/png'});
 record.imageFile=imageFile;record.verdict=qualified?'qualified':'unqualified';
 return final.numeric;
}

/** Explicitly register in both existing files. Never mask a primary body error
 * or turn known strict frame failures into a successful case. */
export async function enforceCapacityFrames(info:TestInfo){
 const records=frames.get(info.testId)??[];frames.delete(info.testId);
 const primaryFailed=info.errors.length>0||info.status==='failed'||info.status==='timedOut'||info.status==='interrupted',bodyVerdict=primaryFailed?'failed':info.status==='passed'?'completed':'not-completed';
 const failed=records.filter(record=>record.verdict==='unqualified'),pending=records.some(record=>record.verdict==='pending');
 try{await jsonFile(info,'capacity-frame-summary.json',{schemaVersion:1,kind:'case-frame-summary',bodyVerdict,visualVerdict:failed.length?'failed':pending?'incomplete':records.length?'qualified':'not-observed',primaryFunctionalErrorPreserved:primaryFailed,frames:records});}
 catch(error){if(!primaryFailed)throw error;info.annotations.push({type:'secondary-frame-summary-error',description:'Frame summary write failed; the existing primary functional error is preserved.'});return;}
 if(primaryFailed)return;
 if(pending)throw Error('Frame qualification did not complete; no visual pass is recorded.');
 if(failed.length)throw Error('Strict viewport qualification failed in '+failed.map(record=>record.name+': '+record.failedGates.join(', ')).join('; ')+'. Functional body verdict: '+bodyVerdict+'. UNQUALIFIED images are diagnostic evidence.');
}
