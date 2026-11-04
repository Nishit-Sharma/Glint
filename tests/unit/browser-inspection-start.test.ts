import {expect,it} from 'vitest';
import type {TaskSession} from '../../src/core/task-session';
import {browserInspectionStartUrl} from '../../src/renderer/src/browser-outcome';

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

it('suggests this action’s saved uncertain review page when reopening, without settling the outcome',()=>{
 const original=run(),current={...original,operations:original.operations.map(operation=>operation.id==='uncertain'?{...operation,receipt:{url:'https://owned.example/orders/old-receipt',status:200,body:'Earlier receipt'},reconciliation:{id:'fresh-review',outcome:'uncertain' as const,basis:'user-reviewed-observation' as const,note:'The fresh page did not settle the outcome.',observation:{...initial,id:'review-page',browserId:'separate-inspection-browser',url:'https://owned.example/orders/receipt-review'}}}:operation)},before=structuredClone(current);
 expect(browserInspectionStartUrl(current,'uncertain')).toBe('https://owned.example/orders/receipt-review');
 expect(current).toEqual(before);
 expect(current.operations[1].status).toBe('uncertain');
});

it.each(['https://other.example/review','https://user:secret@owned.example/review','blob:https://owned.example/review','http://owned.example/review','not a URL'])('ignores an unusable reviewed page and retains the saved page fallback: %s',url=>{
 const original=run(),current={...original,operations:original.operations.map(operation=>operation.id==='uncertain'?{...operation,reconciliation:{id:'review',outcome:'uncertain' as const,basis:'user-reviewed-observation' as const,note:'Still uncertain.',observation:{...initial,browserId:'inspection-browser',url}}}:operation)};
 expect(browserInspectionStartUrl(current,'uncertain')).toBe('https://owned.example/orders/new');
});

it('ignores a reviewed page from a foreign task or an inconsistent settled review',()=>{
 const original=run(),review={id:'review',outcome:'uncertain' as const,basis:'user-reviewed-observation' as const,note:'Still uncertain.',observation:{...initial,browserId:'inspection-browser',taskId:'other-task',url:'https://owned.example/foreign-review'}},current={...original,operations:original.operations.map(operation=>operation.id==='uncertain'?{...operation,reconciliation:review}:operation)};
 expect(browserInspectionStartUrl(current,'uncertain')).toBe('https://owned.example/orders/new');
 const inconsistent={...current,operations:current.operations.map(operation=>operation.id==='uncertain'?{...operation,reconciliation:{...review,outcome:'completed' as const,observation:{...review.observation,taskId:'task'}}}:operation)};
 expect(browserInspectionStartUrl(inconsistent,'uncertain')).toBe('https://owned.example/orders/new');
});

it('does not borrow another action’s reviewed page',()=>{
 const original=run(),current={...original,operations:original.operations.map(operation=>operation.id==='open-form'?{...operation,reconciliation:{id:'other-review',outcome:'uncertain' as const,basis:'user-reviewed-observation' as const,note:'Another action.',observation:{...initial,browserId:'inspection-browser',url:'https://owned.example/other-action-review'}}}:operation)};
 expect(browserInspectionStartUrl(current,'uncertain')).toBe('https://owned.example/orders/new');
});

it('retains the action receipt fallback when the saved review page is unavailable',()=>{
 const original=run(),current={...original,operations:original.operations.map(operation=>operation.id==='uncertain'?{...operation,receipt:{url:'https://owned.example/orders/receipt',status:200,body:'Receipt'},reconciliation:{id:'unusable-review',outcome:'uncertain' as const,basis:'user-reviewed-observation' as const,note:'Still uncertain.',observation:{...initial,browserId:'inspection-browser',url:'not a URL'}}}:operation)};
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
