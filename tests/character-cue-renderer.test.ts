import {afterEach,expect,it,vi} from 'vitest';
vi.mock('react',async original=>({...await original<typeof import('react')>(),...(await import('./controlled-renderer.fixture')).hooks}));
vi.mock('../src/renderer/src/bot-art',()=>({BotImage:()=>null,characterStill:()=>'',CharacterAdornment:()=>null}));
vi.mock('../src/renderer/src/character-original/actor-runtime.js',()=>({mountOriginal:vi.fn()}));
import {createElement} from 'react';
import {createControlledRenderer} from './controlled-renderer.fixture';
import {CharacterProvider,CharacterControl,CharacterAnchor} from '../src/renderer/src/character';
import {DEFAULT_CHARACTER} from '../src/shared/character-catalog';
import {deriveCharacterCue} from '../src/renderer/src/character-cue';
import type {Task} from '../src/core/types';
afterEach(()=>vi.unstubAllGlobals());
it('updates control and anchor status labels and static symbols with movement disabled',()=>{
 const media=Object.assign(new EventTarget(),{matches:true});vi.stubGlobal('matchMedia',()=>media);
 const style={getPropertyValue:()=>'',getPropertyPriority:()=>'',setProperty:()=>{},removeProperty:()=>{}};vi.stubGlobal('document',{documentElement:{style}});
 vi.stubGlobal('window',{companion:{subscribe:()=>()=>{}}});
 const identity={snapshot:{revision:1,profile:{...DEFAULT_CHARACTER,look:{...DEFAULT_CHARACTER.look,motion:false}}},commit:vi.fn(),reload:vi.fn()};
 const owner:Task={id:'owner',title:'Fixture',goal:'',status:'active',createdAt:'now',updatedAt:'now',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false}};
 let cue=deriveCharacterCue(owner),working=false;const opened=vi.fn(),choose=vi.fn();
 const renderer=createControlledRenderer(()=>createElement(CharacterProvider,{surface:'workspace',identity,working,cue,children:[createElement(CharacterControl,{place:'header',onOpen:opened}),createElement(CharacterAnchor,{onOpen:opened,onChooseWindow:choose})]}));
 renderer.render();const control=renderer.find(node=>node.props.className==='character-control character-control-header');expect(control.props['aria-label']).toBe('Customize Glint');expect(renderer.find(node=>node.props.id===control.props['aria-describedby']).children[0].props.text).toContain('Ready for your request');control.props.onClick();expect(opened).toHaveBeenCalledOnce();
 owner.status='paused';cue=deriveCharacterCue(owner);renderer.render();
 for(const node of renderer.nodes().filter(node=>node.type==='button')){expect(['Customize Glint','Open Glint']).toContain(node.props['aria-label']);expect(node.props.title).toContain('Task paused');expect(node.props['aria-describedby'].split(' ').some((id:string)=>renderer.nodes().some(description=>description.props.id===id&&description.children.some(child=>child.props.text?.includes('Task paused'))))).toBe(true);}
 expect(renderer.nodes().filter(node=>node.props.className==='character-cue')).toHaveLength(2);
 expect(renderer.nodes().filter(node=>node.props.className==='character-cue').every(node=>node.props['aria-hidden']==='true')).toBe(true);
 const anchor=renderer.find(node=>node.props.className==='anchor');anchor.props.onKeyDown({key:'ArrowDown',preventDefault:()=>{}});expect(choose).toHaveBeenCalledOnce();
 working=true;renderer.render();expect(renderer.find(node=>node.props.className==='anchor').props.title).toContain('Working on this task');
 expect(renderer.nodes().some(node=>node.props.role==='status'&&node.children.some(child=>child.props.text?.includes('Working on this task')))).toBe(true);
});
