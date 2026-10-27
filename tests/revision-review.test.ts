import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {RevisionReview} from '../src/renderer/src/components/RevisionReview';
import type {ArtifactRevision,Task} from '../src/core/types';
it('historical experiment review keeps unknown validation inputs distinct from confirmed values',()=>{
 const model={schemaVersion:1,kind:'experiment',title:'Group capacity',explanation:'Compare a confirmed guest count with capacity.',unknownInputs:['guests'],spec:{title:'Group capacity',variables:[{name:'guests',unit:'1',min:0,max:100},{name:'capacity',unit:'1',min:1,max:100}],assumptions:['The guest count is not confirmed.'],expression:{op:'divide',left:{op:'variable',name:'guests'},right:{op:'variable',name:'capacity'}}},inputs:{guests:0,capacity:20}};
 const revision:ArtifactRevision={revision:1,title:model.title,content:JSON.stringify(model),mimeType:'application/json',sourceRefs:[],digest:'saved-content',createdAt:'2026-10-24T10:00:00Z'},artifact={id:'capacity',revisions:[revision]},task:Task={id:'task',title:'Visit',goal:'',status:'active',createdAt:revision.createdAt,updatedAt:revision.createdAt,sources:[],artifacts:[artifact],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
 const html=renderToStaticMarkup(createElement(RevisionReview,{task,artifact,revision,back:()=>{},onLatest:()=>{}}));expect(html).toContain('Not confirmed');expect(html).toContain('<dd>20</dd>');expect(html).not.toContain('<dd>0</dd>');expect(revision.content).toBe(JSON.stringify(model));
});
