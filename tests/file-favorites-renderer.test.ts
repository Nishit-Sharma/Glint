import {expect,test,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...((await import('./controlled-renderer.fixture')).hooks)}));
import {createElement} from 'react';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCompanion} from '../src/core/companion';
import {TaskViewPreferences} from '../src/host/task-view-preferences';
import {readFileFavoritesCommand} from '../src/shared/task-view';
import {resolveSavedWorkMatch,type SavedWorkMatch,type SavedWorkSearchState} from '../src/shared/saved-work-search';
import {SavedWorkSearch,type SavedWorkOpenScope} from '../src/renderer/src/components/SavedWorkSearch';
import {createControlledRenderer} from './controlled-renderer.fixture';
import type {Command} from '../src/shared/bridge';

test('real saved-file results can be favorited, filtered, reopened in quick access and unfavorited without changing content or drafts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-file-favorites-ui-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned favorite task'}),saved=await core.saveArtifact(task.id,{title:'Owned first file',content:'Synthetic favorite content.'});
  await core.saveArtifact(task.id,{title:'Owned second file',content:'Unmarked synthetic content.'});await core.saveComposerDraft(task.id,0,{text:'  UNSENT_QA\n',kind:'explain'});
  const tasks=await core.listTasks(),before=await readFile(join(directory,'tasks.json'),'utf8'),prefs=new TaskViewPreferences(directory,async id=>tasks.some(task=>task.id===id),id=>core.getTask(id));
  let tail:Promise<unknown>=Promise.resolve(),state:SavedWorkSearchState={query:'Owned',scope:'files'};const commands:string[]=[],opened:Array<{match:SavedWorkMatch;scope:SavedWorkOpenScope}>=[];
  vi.stubGlobal('window',{companion:{invoke(input:Command){const command=readFileFavoritesCommand(input);commands.push(command.type);const operation=command.type==='file-favorites.get'?prefs.readFileFavorites():prefs.changeFileFavorites({expectedRevision:command.expectedRevision,change:command.change});tail=operation;return operation;}}});
  const make=()=>createControlledRenderer(()=>createElement(SavedWorkSearch,{tasks,state,onChange:next=>{state=next;},onOpen:(match,scope)=>{resolveSavedWorkMatch(tasks.find(task=>task.id===match.taskId)!,match);opened.push({match,scope});}}));
  let renderer=make();type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join('');
  const button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),settle=async()=>{await tail;renderer.render();};
  renderer.render();await settle();expect(renderer.nodes().some(node=>node.type==='#text'&&String(node.props.text).includes('No favorite files yet.'))).toBe(true);
  renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});renderer.render();button('Favorite Owned first file').props.onClick();await settle();
  expect(renderer.nodes().some(node=>node.props['aria-label']==='Open favorite current revision: Owned first file in Owned favorite task')).toBe(true);
  button('Show only favorite file matches').props.onClick();renderer.render();expect(renderer.nodes().filter(node=>typeof node.props['aria-label']==='string'&&node.props['aria-label'].startsWith('Open saved revision:')).map(node=>node.props['aria-label'])).toEqual(['Open saved revision: Owned first file in Owned favorite task']);
  renderer.find(node=>node.props['aria-label']==='Open favorite current revision: Owned first file in Owned favorite task').props.onClick();expect(opened[0].match).toMatchObject({taskId:task.id,artifactId:saved.artifactId,revision:1,digest:saved.revision.digest});
  expect(opened[0].scope.current()).toBe(true);renderer.find(node=>node.type==='input'&&node.props.type==='search').props.onChange({target:{value:'Another search'}});renderer.render();expect(opened[0].scope.current()).toBe(false);
  state={query:'',scope:'all'};renderer=make();renderer.render();await settle();expect(renderer.nodes().some(node=>node.props['aria-label']==='Open favorite current revision: Owned first file in Owned favorite task')).toBe(true);expect(renderer.find(node=>node.type==='input').props.value).toBe('');
  button('Unfavorite Owned first file').props.onClick();await settle();expect(await prefs.readFileFavorites()).toEqual({kind:'available',revision:2,items:[]});expect(commands.every(type=>type==='file-favorites.get'||type==='file-favorites.change')).toBe(true);expect(await readFile(join(directory,'tasks.json'),'utf8')).toBe(before);
 }
 finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});

test('a lost preference acknowledgement blocks further changes until explicit reload reconciles the real saved result',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'glint-file-favorites-uncertain-')),core=await createCompanion({dataDir:directory});
 try{
  const task=await core.createTask({title:'Owned receipt QA'});await core.saveArtifact(task.id,{title:'Owned receipt file',content:'Synthetic unchanged file.'});
  const tasks=await core.listTasks(),prefs=new TaskViewPreferences(directory,async id=>tasks.some(task=>task.id===id),id=>core.getTask(id));let tail:Promise<unknown>=Promise.resolve(),state:SavedWorkSearchState={query:'Owned',scope:'files'},lose=true;const changes:string[]=[];
  vi.stubGlobal('window',{companion:{invoke(input:Command){const command=readFileFavoritesCommand(input);let operation:Promise<unknown>;if(command.type==='file-favorites.get')operation=prefs.readFileFavorites();else{changes.push(command.change.kind);operation=prefs.changeFileFavorites({expectedRevision:command.expectedRevision,change:command.change}).then(saved=>{if(lose){lose=false;throw Error('Owned lost acknowledgement');}return saved;});}tail=operation;return operation;}}});
  const renderer=createControlledRenderer(()=>createElement(SavedWorkSearch,{tasks,state,onChange:next=>{state=next;},onOpen:()=>{}}));type Node=ReturnType<typeof renderer.nodes>[number];const text=(node:Node):string=>node.type==='#text'?node.props.text:node.children.map(text).join(''),button=(label:string)=>renderer.find(node=>node.type==='button'&&text(node)===label),settle=async()=>{await tail.catch(()=>{});renderer.render();};
  renderer.render();await settle();renderer.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});renderer.render();button('Favorite Owned receipt file').props.onClick();await settle();expect(button('Favorite Owned receipt file').props.disabled).toBe(true);button('Favorite Owned receipt file').props.onClick();expect(changes).toEqual(['favorite']);expect(renderer.nodes().some(node=>node.props.role==='alert'&&text(node).includes('Reload favorites'))).toBe(true);
  button('Reload favorites').props.onClick();await settle();expect(renderer.nodes().some(node=>node.props['aria-label']==='Open favorite current revision: Owned receipt file in Owned receipt QA')).toBe(true);expect(changes).toEqual(['favorite']);expect((await core.getTask(task.id)).requests).toEqual([]);
 }
 finally{vi.unstubAllGlobals();await core.close();await rm(directory,{recursive:true,force:true});}
});
