import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {Task,Source} from '../../../core/types';
import {publicErrorMessage} from '../../../shared/public-messages';
import {Button,Field,type Run} from '../ui';
import {useNavigationDraft} from '../draft-navigation';
import {CropSelector,type PixelCrop} from './CropSelector';
import {annotationFontSize,layoutAnnotation} from './annotation-layout';
import './image-transform.css';

export function ImageTransform({task,source,busy,run,open=false}:{task:Task;source:Source;busy:boolean;run:Run;open?:boolean}){
 const v=source.versions[source.versions.length-1],canvas=useRef<HTMLCanvasElement>(null);
 const [decoded,setDecoded]=useState<{element:HTMLImageElement;digest:string}>(),[crop,setCrop]=useState<PixelCrop>({x:0,y:0,width:1,height:1});
 const [annotation,setAnnotation]=useState(''),[title,setTitle]=useState(v.label+' — crop'),[error,setError]=useState('');
 const [drawnKey,setDrawnKey]=useState(''),[edited,setEdited]=useState(false),[annotationError,setAnnotationError]=useState(''),[mode,setMode]=useState<'crop'|'annotate'>('crop');
 const clearNavigationDraft=useNavigationDraft(edited),snapshot=JSON.stringify([v.digest,crop,annotation,title]),snapshotRef=useRef(snapshot);snapshotRef.current=snapshot;
 const image=decoded?.digest===v.digest?decoded.element:undefined,renderKey=JSON.stringify([v.digest,crop,annotation]);
 useEffect(()=>{
  let active=true;setDecoded(undefined);setDrawnKey('');setError('');
  const im=new window.Image();
  im.onload=()=>{if(!active)return;setDecoded({element:im,digest:v.digest});setCrop({x:0,y:0,width:im.naturalWidth,height:im.naturalHeight});};
  im.onerror=()=>{if(active)setError('This image could not be opened. Choose another image.');};
  im.src=v.content;
  return()=>{active=false;im.onload=null;im.onerror=null;};
 },[v.digest]);
 const valid=!!image&&Object.values(crop).every(Number.isInteger)&&crop.x>=0&&crop.y>=0&&crop.width>0&&crop.height>0&&crop.x+crop.width<=image.naturalWidth&&crop.y+crop.height<=image.naturalHeight&&crop.width*crop.height<=16000000;
 useLayoutEffect(()=>{
  setDrawnKey('');setAnnotationError('');if(!image||!canvas.current||!valid)return;
  const c=canvas.current;c.width=crop.width;c.height=crop.height;
  const ctx=c.getContext('2d')!;ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,c.width,c.height);
  const size=annotationFontSize(c.width,c.height);ctx.font=`${size}px system-ui`;
  const layout=layoutAnnotation({text:annotation,width:c.width,height:c.height},text=>ctx.measureText(text).width);
  if(!layout.ok){setAnnotationError(layout.message);return;}
  if(layout.lines.length){ctx.fillStyle='rgba(249,250,247,.95)';ctx.fillRect(layout.background.x,layout.background.y,layout.background.width,layout.background.height);ctx.fillStyle='#252925';ctx.textBaseline='top';ctx.textAlign='left';layout.lines.forEach(line=>ctx.fillText(line.text,line.x,line.y));}
  setDrawnKey(renderKey);
 },[image,crop,annotation,valid,renderKey]);
 async function save(){
  if(!canvas.current||!valid||decoded?.digest!==v.digest||drawnKey!==renderKey)return;
  setError('');
  try{
   const submitted=snapshot,png=canvas.current.toDataURL('image/png').split(',')[1];
   const saved=await run({type:'artifact.save',taskId:task.id,artifact:{title,content:png,mimeType:'image/png',encoding:'base64',sourceRefs:[{sourceId:source.id,version:v.version,digest:v.digest}]}},'Edited image saved to task');
   if(saved&&snapshotRef.current===submitted){clearNavigationDraft();setEdited(false);}
  }catch(e){setError(publicErrorMessage(e));}
 }
 const workspace=<div className="image-workspace">
  <div className="image-mode-strip" role="group" aria-label="Image editing mode">
   <button type="button" aria-pressed={mode==='crop'} onClick={()=>setMode('crop')}>Crop</button>
   <button type="button" aria-pressed={mode==='annotate'} onClick={()=>setMode('annotate')}>Add annotation</button>
  </div>
  <div className="image-editor-scroll">
   {mode==='crop'&&image&&<CropSelector image={{src:v.content,width:image.naturalWidth,height:image.naturalHeight}} crop={crop} disabled={busy} onChange={next=>{setCrop(next);setEdited(true);}}/>}
   <figure className="image-editor-preview" hidden={mode!=='annotate'||!valid||drawnKey!==renderKey}>
    <canvas className="crop-preview" ref={canvas} role="img" aria-label="Preview of cropped and annotated image" aria-description={`${crop.width} by ${crop.height} pixels${annotation?', annotation: '+annotation:''}`}/>
   </figure>
   {mode==='annotate'&&<div className="image-annotation"><Field label="Annotation (optional)"><textarea rows={2} value={annotation} maxLength={300} onChange={event=>{setAnnotation(event.target.value);setEdited(true);}} placeholder="Add a note along the bottom"/></Field></div>}
   <details className="image-output-details"><summary>Output details · {valid?`${crop.width} × ${crop.height} pixels`:'Review crop'}</summary>
    <Field label="Image title"><input value={title} onChange={event=>{setTitle(event.target.value);setEdited(true);}}/></Field>
    <div className="two-fields">{(['x','y','width','height'] as const).map(key=><Field label={key==='x'?'Left (px)':key==='y'?'Top (px)':key==='width'?'Width (px)':'Height (px)'} key={key}><input type="number" min={key==='width'||key==='height'?1:0} step={1} value={Number.isNaN(crop[key])?'':crop[key]} onChange={event=>{setCrop({...crop,[key]:event.target.valueAsNumber});setEdited(true);}}/></Field>)}</div>
   </details>
  </div>
  <footer className="image-editor-footer">
   {!valid&&<p className="warning">{!image&&!error?'Loading the current image…':'Keep the crop inside the image and use whole pixels, up to 16 million pixels.'}</p>}
   {(error||annotationError)&&<p className="warning" role="alert">{error||annotationError}</p>}
   <Button kind="primary" disabled={busy||!valid||drawnKey!==renderKey||!title.trim()} onClick={()=>void save()}>Save edited image</Button>
  </footer>
 </div>;
 return open?<section className="image-transform image-editor-open" aria-label="Crop and annotate image">{workspace}</section>:<details className="image-transform"><summary>Crop & annotate</summary>{workspace}</details>;
}
