import {expect,it} from 'vitest';
import type {TaskSession} from '../src/core/task-session';
import {browserInspectionStartUrl} from '../src/renderer/src/browser-outcome';

const initial={id:'first',taskId:'task',browserId:'browser',documentId:'document',url:'https://owned.example/catalog',title:'Catalog',text:'Catalog',digest:'first-digest',targets:[]};
const run=():TaskSession['runs'][number]=>({id:'run',endpointKey:'fixture',origin:'https://owned.example',browserId:'browser',initialObservation:initial,operations:[
 {id:'open-form',intent:{kind:'click',snapshotId:'first',targetId:'open'},reason:'Open form',status:'observed',result:{...initial,id:'form',url:'https://owned.example/orders/new'}},
 {id:'uncertain',intent:{kind:'click',snapshotId:'submit',targetId:'save'},reason:'Submit once',status:'uncertain'},
 {id:'later',intent:{kind:'click',snapshotId:'later',targetId:'link'},reason:'Later',status:'observed',result:{...initial,id:'later',url:'https://owned.example/other'}},
]});

it('starts from the last saved page before the uncertain action, never a later page',()=>{
 expect(browserInspectionStartUrl(run(),'uncertain')).toBe('https://owned.example/orders/new');
});

it('preserves an actual same-site receipt over the earlier page',()=>{
 const original=run(),current={...original,operations:original.operations.map(operation=>operation.id==='uncertain'?{...operation,receipt:{url:'https://owned.example/orders/receipt',status:200,body:'Receipt'}}:operation)};
 expect(browserInspectionStartUrl(current,'uncertain')).toBe('https://owned.example/orders/receipt');
});

it.each(['https://other.example/orders','https://user:secret@owned.example/orders','blob:https://owned.example/owned-id','not a URL'])('ignores unsafe or malformed saved pages: %s',url=>{
 const original=run(),current={...original,operations:original.operations.map(operation=>operation.id==='uncertain'?{...operation,receipt:{url,status:200,body:''}}:operation.id==='open-form'?{...operation,result:{...initial,url}}:operation)};
 expect(browserInspectionStartUrl(current,'uncertain')).toBe('https://owned.example/catalog');
});

it('falls back to the original site if no saved same-site page remains, and never invents an action',()=>{
 const original=run(),current={...original,initialObservation:{...initial,url:'https://other.example'},operations:original.operations.map(operation=>operation.id==='open-form'?{...operation,result:{...initial,url:'https://other.example'}}:operation)};
 expect(browserInspectionStartUrl(current,'uncertain')).toBe('https://owned.example/');
 expect(browserInspectionStartUrl(current,'missing')).toBe('');
});
