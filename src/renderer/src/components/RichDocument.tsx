import {useEffect,useMemo,useRef} from 'react';
import {useEditor,useEditorState,EditorContent} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CodeBlock from '@tiptap/extension-code-block';
import {Markdown} from '@tiptap/markdown';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import {Bold,Italic,List,ListChecks} from 'lucide-react';
import {canEditRichText,editableDocumentBody} from '../document-format';

const SafeCodeBlock=CodeBlock.extend({renderMarkdown(node,helpers){const text=helpers.renderChildren(node.content??[]);let longest=2;for(const match of text.matchAll(/`+/g))longest=Math.max(longest,match[0].length);const fence='`'.repeat(longest+1);return fence+(node.attrs?.language||'')+'\n'+text+'\n'+fence;}});
type Props={value:string;title:string;documentKey:string;onChange:(value:string)=>void;disabled?:boolean};
export default function RichDocument(props:Props){
 // A value this component just emitted keeps the mode it was typed in; only an outside value (revision load, page reference) re-checks support.
 const own=useRef<{key:string;value:string;rich:boolean}>(undefined),typed=own.current?.key===props.documentKey&&own.current.value===props.value?own.current.rich:undefined;
 const supported=useMemo(()=>typed??canEditRichText(props.value),[props.documentKey,props.value,typed]);
 const emit=(value:string,rich:boolean)=>{own.current={key:props.documentKey,value,rich};props.onChange(value);};
 if(!supported)return <textarea aria-label="Draft content" value={props.value} disabled={props.disabled} onChange={event=>emit(event.target.value,false)}/>;
 return <RichDocumentEditor {...props} onChange={value=>emit(value,true)}/>;
}
function RichDocumentEditor({value,title,onChange,disabled=false}:Props){
 const change=useRef(onChange),currentTitle=useRef(title),lastEmitted=useRef(value),prefix=useRef(editableDocumentBody(value,title).prefix);change.current=onChange;currentTitle.current=title;
 const editor=useEditor({
  extensions:[StarterKit.configure({link:false,underline:false,codeBlock:false}),SafeCodeBlock,Markdown,TaskList,TaskItem.configure({nested:true})],
  content:editableDocumentBody(value,title).body,contentType:'markdown',immediatelyRender:false,shouldRerenderOnTransaction:false,
  editorProps:{attributes:{role:'textbox','aria-label':'Draft content','aria-multiline':'true',spellcheck:'false',class:'rich-document-body'},
   handlePaste(view,event){event.preventDefault();const text=event.clipboardData?.getData('text/plain')??'';if(text.length===0)return true;view.dispatch(view.state.tr.insertText(text));return true;},
   handleDrop(_view,event){event.preventDefault();return true;},
  },
  onUpdate({editor}){const body=editor.getMarkdown(),next=(prefix.current?'# '+currentTitle.current+'\n\n':'')+body;lastEmitted.current=next;change.current(next);},
 });
 const state=useEditorState({editor,selector:({editor})=>({bold:editor?.isActive('bold')??false,italic:editor?.isActive('italic')??false,list:editor?.isActive('bulletList')??false,task:editor?.isActive('taskList')??false})});
 useEffect(()=>{editor?.setEditable(!disabled,false);},[editor,disabled]);
 useEffect(()=>{if(!editor||value===lastEmitted.current)return;const next=editableDocumentBody(value,title);prefix.current=next.prefix;lastEmitted.current=value;editor.commands.setContent(next.body,{contentType:'markdown',emitUpdate:false});},[editor,value,title]);
 if(!editor)return <p className="tiny" role="status">Opening editor…</p>;
 return <div className="rich-document"><div className="rich-formatbar" role="group" aria-label="Text formatting"><button type="button" title="Bold" aria-label="Bold" aria-pressed={state?.bold} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>editor.chain().focus().toggleBold().run()}><Bold size={15}/></button><button type="button" title="Italic" aria-label="Italic" aria-pressed={state?.italic} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>editor.chain().focus().toggleItalic().run()}><Italic size={15}/></button><button type="button" title="Bulleted list" aria-label="Bulleted list" aria-pressed={state?.list} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>editor.chain().focus().toggleBulletList().run()}><List size={15}/></button><button type="button" title="Checklist" aria-label="Checklist" aria-pressed={state?.task} disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>editor.chain().focus().toggleTaskList().run()}><ListChecks size={15}/></button></div><EditorContent editor={editor}/></div>;
}
