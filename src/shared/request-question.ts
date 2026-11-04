import {Schema} from 'effect';

export const QUESTION_LIMITS={rounds:3,options:8,question:1200,label:240,alternative:4000,protocol:12000,pending:32768} as const;
const text=(max:number)=>Schema.String.pipe(Schema.minLength(1),Schema.maxLength(max),Schema.filter(value=>!!value.trim()&&!value.includes('\0')));
const id=text(200),digest=Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),positive=Schema.Int.pipe(Schema.positive());
const choiceId=Schema.String.pipe(Schema.pattern(/^[a-zA-Z][\w-]{0,39}$/));
export const RequestQuestionDefinitionSchema=Schema.Struct({question:text(QUESTION_LIMITS.question),mode:Schema.Literal('single','multiple','ranking'),options:Schema.Array(Schema.Struct({id:choiceId,label:text(QUESTION_LIMITS.label)})).pipe(Schema.minItems(2),Schema.maxItems(QUESTION_LIMITS.options),Schema.mutable)}).pipe(Schema.filter(value=>new Set(value.options.map(option=>option.id)).size===value.options.length&&new Set(value.options.map(option=>option.label.normalize('NFC').trim().toLowerCase())).size===value.options.length));
export type RequestQuestionDefinition={question:string;mode:'single'|'multiple'|'ranking';options:{id:string;label:string}[]};
const AnswerSchema=Schema.Union(Schema.Struct({kind:Schema.Literal('choices'),ids:Schema.Array(choiceId).pipe(Schema.minItems(1),Schema.maxItems(QUESTION_LIMITS.options),Schema.mutable)}),Schema.Struct({kind:Schema.Literal('alternative'),text:text(QUESTION_LIMITS.alternative)}));
export const RequestQuestionDecisionSchema=Schema.Union(AnswerSchema,Schema.Struct({kind:Schema.Literal('skip')}));
export type RequestQuestionDecision={kind:'choices';ids:string[]}|{kind:'alternative';text:string}|{kind:'skip'};
export const RequestQuestionRecordSchema=Schema.Struct({id,digest,revision:positive,definition:RequestQuestionDefinitionSchema,status:Schema.Literal('waiting','answered','skipped','closed'),createdAt:id,resolvedAt:Schema.optional(id),decision:Schema.optional(RequestQuestionDecisionSchema),reason:Schema.optional(text(2000))}).pipe(Schema.filter(value=>value.status==='waiting'?value.revision===1&&value.decision===undefined&&value.resolvedAt===undefined:value.revision===2&&!!value.resolvedAt&&(value.status==='closed'?value.decision===undefined&&!!value.reason:value.status==='skipped'?value.decision?.kind==='skip':value.decision!==undefined&&value.decision.kind!=='skip')));
export type RequestQuestionRecord={id:string;digest:string;revision:number;definition:RequestQuestionDefinition;status:'waiting'|'answered'|'skipped'|'closed';createdAt:string;resolvedAt?:string;decision?:RequestQuestionDecision;reason?:string};
const binding={taskId:id,requestId:id,requestDigest:digest,questionId:id,questionDigest:digest};
export const RequestQuestionCommandSchema=Schema.Union(Schema.Struct({type:Schema.Literal('request.question.inspect'),...binding}),Schema.Struct({type:Schema.Literal('request.question.answer'),...binding,expectedRevision:positive,decision:AnswerSchema}),Schema.Struct({type:Schema.Literal('request.question.skip'),...binding,expectedRevision:positive}));
export type RequestQuestionCommand=typeof RequestQuestionCommandSchema.Type;
export type RequestQuestionBinding={taskId:string;requestId:string;requestDigest:string;questionId:string;questionDigest:string};
export const RequestQuestionReplySchema=Schema.Struct({...binding,question:RequestQuestionRecordSchema,active:Schema.Boolean});
export type RequestQuestionReply=Omit<typeof RequestQuestionReplySchema.Type,'question'>&{question:RequestQuestionRecord};
const read=<A,I>(schema:Schema.Schema<A,I>,value:unknown):A=>Schema.decodeUnknownSync(schema,{onExcessProperty:'error'})(value);
export const readRequestQuestionDefinition=(value:unknown)=>structuredClone(read(RequestQuestionDefinitionSchema,value)) as RequestQuestionDefinition;
export const readRequestQuestionCommand=(value:unknown)=>read(RequestQuestionCommandSchema,value);
export const readRequestQuestionReply=(value:unknown)=>structuredClone(read(RequestQuestionReplySchema,value)) as RequestQuestionReply;

export function requestQuestionDecision(definition:RequestQuestionDefinition,value:unknown):RequestQuestionDecision{
 const decision=structuredClone(read(RequestQuestionDecisionSchema,value)) as RequestQuestionDecision;
 if(decision.kind!=='choices')return decision;
 const allowed=definition.options.map(option=>option.id);
 if(new Set(decision.ids).size!==decision.ids.length||decision.ids.some(id=>!allowed.includes(id))||definition.mode==='single'&&decision.ids.length!==1||definition.mode==='ranking'&&decision.ids.length!==allowed.length)throw Error('Choose an answer from this exact question. Rankings must include every option once.');
 return definition.mode==='ranking'?decision:{kind:'choices',ids:allowed.filter(id=>decision.ids.includes(id))};
}
export const sameRequestQuestionDecision=(a:RequestQuestionDecision|undefined,b:RequestQuestionDecision)=>JSON.stringify(a)===JSON.stringify(b);
export function closeRequestQuestions(questions:RequestQuestionRecord[]|undefined,time:string,reason:string){for(const question of questions??[])if(question.status==='waiting'){question.status='closed';question.revision=2;question.resolvedAt=time;question.reason=reason;}}

export const REQUEST_QUESTION_SLOT='request-question:answer';
export const RequestQuestionDraftOwnerSchema=Schema.Struct({kind:Schema.Literal('request-question'),...binding});
export type RequestQuestionDraftOwner=typeof RequestQuestionDraftOwnerSchema.Type;
export type RequestQuestionRawDraft={selected:boolean[];ranking:string[];useAlternative:boolean;alternative:string;pendingText:string};
export const requestQuestionDraftIdentity=(owner:RequestQuestionDraftOwner)=>JSON.stringify([owner.taskId,owner.requestId,owner.requestDigest,owner.questionId,owner.questionDigest]);
export const requestQuestionDraftBasis=(owner:RequestQuestionDraftOwner)=>JSON.stringify({basis:requestQuestionDraftIdentity(owner),variableArrays:[]});
export const initialRequestQuestionDraft=(question:RequestQuestionRecord):RequestQuestionRawDraft=>({selected:question.definition.options.map(()=>false),ranking:question.definition.options.map(option=>option.id),useAlternative:false,alternative:'',pendingText:''});
const RawDraftSchema=Schema.Struct({selected:Schema.Array(Schema.Boolean).pipe(Schema.maxItems(QUESTION_LIMITS.options)),ranking:Schema.Array(choiceId).pipe(Schema.maxItems(QUESTION_LIMITS.options)),useAlternative:Schema.Boolean,alternative:Schema.String.pipe(Schema.maxLength(QUESTION_LIMITS.alternative)),pendingText:Schema.String.pipe(Schema.maxLength(QUESTION_LIMITS.pending))});
export const readRequestQuestionRawDraft=(value:unknown)=>structuredClone(read(RawDraftSchema,value)) as RequestQuestionRawDraft;
