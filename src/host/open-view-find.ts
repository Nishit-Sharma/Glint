import {readOpenViewFindCommand,type OpenViewFindEvent} from '../shared/open-view-find';
type FindTarget={findInPage:(text:string,options:{forward:boolean;findNext:boolean;matchCase:boolean})=>number;stopFindInPage:(action:'clearSelection')=>void};
export class OpenViewFind{
 private scope='';private query='';private requestId:number|undefined;
 constructor(private readonly target:FindTarget,private readonly emit:(event:OpenViewFindEvent)=>void){}
 open(){if(this.scope)this.emit({type:'view.find.open',scope:this.scope});}
 handle(value:unknown){const command=readOpenViewFindCommand(value);if(command.action==='bind'){if(command.scope!==this.scope){this.clear();this.scope=command.scope;}return null;}if(command.scope!==this.scope)throw Error('The open view changed. Open Find again.');
  if(command.action==='close'){this.clear();return null;}if(command.action==='query'){this.query=command.query!;if(!this.query){this.clear();this.emit({type:'view.find.result',scope:this.scope,requestId:0,query:'',current:0,total:0,final:true});return null;}}
  if(!this.query)return null;this.requestId=this.target.findInPage(this.query,{forward:command.action!=='previous',findNext:command.action==='next'||command.action==='previous',matchCase:false});return null;
 }
 found(result:{requestId:number;activeMatchOrdinal:number;matches:number;finalUpdate:boolean}){if(this.requestId===undefined||result.requestId!==this.requestId||!this.query)return;this.emit({type:'view.find.result',scope:this.scope,requestId:result.requestId,query:this.query,current:result.activeMatchOrdinal,total:result.matches,final:result.finalUpdate});}
 clear(){this.requestId=undefined;this.query='';this.target.stopFindInPage('clearSelection');}
}
