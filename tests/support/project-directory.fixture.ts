import type {Source,SourceVersion,Task} from '../../src/core/types';
import type {Project} from '../../src/shared/projects';

const savedAt='2026-10-31T09:00:00.000Z';
const task=(id:string,title:string,projectId:string|undefined,sources:Source[]=[]):Task=>({id,title,projectId,goal:'',status:'active',createdAt:savedAt,updatedAt:savedAt,sources,artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}});
const old:SourceVersion={id:'guide-source',kind:'text',label:'Access notes',content:'PRIVATE_PINNED_TEXT',role:'fact',version:1,digest:'guide-old',capturedAt:savedAt};
const next:SourceVersion={...old,label:'Future field guide',content:'PRIVATE_LATEST_TEXT',role:'style',version:2,digest:'guide-new'};
const image:SourceVersion={id:'image-source',kind:'image',label:'Canopy reference',content:'data:image/png;base64,PRIVATE_IMAGE',role:'inspiration',version:3,digest:'canopy-saved',capturedAt:savedAt};
export function projectDirectoryFixture():{projects:Project[];tasks:Task[]}{
 return {
  projects:[
   {id:'survey',name:'Survey planning',instructions:'',revision:1,createdAt:savedAt,updatedAt:savedAt,sources:[{id:'shared-guide',taskId:'guide-owner',reference:{sourceId:old.id,version:1,digest:old.digest}}]},
   {id:'supply',name:'Supply rota',instructions:'',revision:1,createdAt:savedAt,updatedAt:savedAt,sources:[{id:'shared-image',taskId:'image-owner',reference:{sourceId:image.id,version:3,digest:image.digest}},{id:'missing-owner',taskId:'unloaded-owner',reference:{sourceId:'missing-source',version:4,digest:'unavailable'}}]},
   {id:'empty',name:'Empty notebook',instructions:'',revision:1,createdAt:savedAt,updatedAt:savedAt,sources:[]}
  ],
  tasks:[task('guide-owner','Field visit','survey',[{id:old.id,currentVersion:2,versions:[old,next],freshness:'fresh'}]),{...task('second-member','Archived task','survey'),archive:{id:'457d6a30-72a4-4b63-8ec2-f639d9b3f24f',archivedAt:savedAt}},task('image-owner','Portrait references','other-project',[{id:image.id,currentVersion:3,versions:[image],freshness:'refresh-required',staleReason:'Original changed'}]),task('ungrouped','Ungrouped task',undefined)]
 };
}
