import {useEffect,useRef,useState} from 'react';
import {LOCAL_CONTACT_FIELDS,LOCAL_CONTACT_LABELS,LOCAL_CONTACT_LIMIT,emptyLocalContactDetails,localContactMessage,readLocalContacts,readLocalContactsCommit,searchLocalContacts,type LocalContact,type LocalContactDetails,type LocalContactField,type LocalContacts as ContactBook,type LocalContactsChange} from '../../shared/local-contacts';
import {publicErrorMessage} from '../../shared/public-messages';
import {useNavigationDraft} from './draft-navigation';
import {Button,Field} from './ui';
import './local-contacts.css';

type Surface={kind:'list'}|{kind:'detail';id:string}|{kind:'edit';id?:string;expectedRevision:number;initial:LocalContactDetails}|{kind:'preview';contact:LocalContact};
export function LocalContacts({onInsert}:{onInsert?:(text:string)=>void}){
 const [book,setBook]=useState<ContactBook>(),[surface,setSurface]=useState<Surface>({kind:'list'}),[details,setDetails]=useState(emptyLocalContactDetails),[query,setQuery]=useState(''),[archived,setArchived]=useState(false),[fields,setFields]=useState<LocalContactField[]>(['name']),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[opening,setOpening]=useState(0);
 const alive=useRef(true),lock=useRef(false),nameInput=useRef<HTMLInputElement>(null);
 const dirty=surface.kind==='edit'&&JSON.stringify(details)!==JSON.stringify(surface.initial);
 const clearDraft=useNavigationDraft(dirty||pending);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let current=true;void window.companion.invoke({type:'contacts.get'}).then(value=>{if(current){setBook(readLocalContacts(value));setError('');}}).catch(()=>{if(current)setError('Contacts could not be opened. Your saved data has been kept.');});return()=>{current=false;};},[opening]);
 useEffect(()=>{if(surface.kind==='edit')nameInput.current?.focus();},[surface.kind]);
 function go(next:Surface){setSurface(next);setError('');setNotice('');}
 function edit(contact?:LocalContact){
  if(!book)return;
  const initial=contact?{name:contact.name,email:contact.email,phone:contact.phone,address:contact.address,notes:contact.notes}:emptyLocalContactDetails();
  setDetails(initial);go({kind:'edit',...(contact?{id:contact.id}:{}),expectedRevision:book.revision,initial});
 }
 async function change(change:LocalContactsChange['change'],expectedRevision=book?.revision){
  if(lock.current||expectedRevision===undefined)return;
  lock.current=true;setPending(true);setError('');setNotice('');
  try{
   const result=readLocalContactsCommit(await window.companion.invoke({type:'contacts.change',expectedRevision,change}));
   if(!alive.current)return;
   setBook(result.current);
   if(result.kind==='conflict'){setError('Contacts changed elsewhere. Your edits are still here. Cancel edits and reopen the contact before saving again.');return;}
   clearDraft();setSurface({kind:'list'});
   setNotice(change.kind==='save'?'Contact saved on this Mac.':change.archived?'Contact archived. You can restore it from Archived.':'Contact restored.');
  }catch(cause){if(alive.current)setError(publicErrorMessage(cause)+' Your edits are still here. Reopen contacts to confirm the saved state.');}
  finally{lock.current=false;if(alive.current)setPending(false);}
 }
 async function insert(){
  if(lock.current||surface.kind!=='preview'||!onInsert)return;
  const selected=surface.contact,preview=localContactMessage(selected,fields);if(!preview)return;
  lock.current=true;setPending(true);setError('');
  try{
   const current=readLocalContacts(await window.companion.invoke({type:'contacts.get'}));
   if(!alive.current)return;
   const contact=current.contacts.find(item=>item.id===selected.id);
   setBook(current);
   if(!contact||contact.archived||contact.revision!==selected.revision){setSurface({kind:'list'});setError('This contact changed. Select it again to review its current details.');return;}
   clearDraft();onInsert(preview);
  }catch(cause){if(alive.current)setError(publicErrorMessage(cause));}
  finally{lock.current=false;if(alive.current)setPending(false);}
 }
 const selected=surface.kind==='detail'?book?.contacts.find(contact=>contact.id===surface.id):undefined;
 const preview=surface.kind==='preview'?localContactMessage(surface.contact,fields):'';
 return <section className="preference-area local-contacts" aria-label="Contacts">
  <p className="preference-explanation">Contacts stay on this Mac. Choose fields and review them before inserting them into a message. Nothing is shared until you send that message.</p>
  <p className="tiny">This is local storage, not a secure vault or a connected Google, Zoho or macOS address book. Keep passwords and secrets out. Archived contacts remain recoverable.</p>
  {!book?<><p role={error?'alert':'status'}>{error||'Opening local contacts…'}</p>{error&&<Button onClick={()=>setOpening(value=>value+1)}>Open contacts again</Button>}</>:<>
   {surface.kind==='list'&&<>
    <div className="row"><Button disabled={pending||book.contacts.length>=LOCAL_CONTACT_LIMIT} onClick={()=>edit()}>Add contact</Button><Button kind="text" disabled={pending} onClick={()=>{setArchived(value=>!value);setNotice('');}}>{archived?'Show active contacts':'Archived'}</Button></div>
    <Field label={archived?'Search archived contacts':'Search contacts'}><input type="search" value={query} maxLength={300} onChange={event=>setQuery(event.target.value)}/></Field>
    <div className="local-contact-list" aria-label={archived?'Archived contacts':'Saved contacts'}>{searchLocalContacts(book,query,archived).map(contact=><button type="button" className="list-row" key={contact.id} disabled={pending} onClick={()=>go({kind:'detail',id:contact.id})}><span><strong>{contact.name}</strong><small>{contact.email||contact.phone||contact.address.split('\n')[0]||'No additional details'}</small></span></button>)}</div>
    {!searchLocalContacts(book,query,archived).length&&<p className="muted">{query?'No contacts match this search.':archived?'No archived contacts.':'No contacts saved yet. Add a name and any details you want to keep.'}</p>}
    {book.contacts.length>=LOCAL_CONTACT_LIMIT&&<p role="status">The local limit of {LOCAL_CONTACT_LIMIT} contacts includes archived contacts.</p>}
   </>}
   {surface.kind==='detail'&&(selected?<>
    <h3>{selected.name}</h3>
    <dl className="local-contact-details">{LOCAL_CONTACT_FIELDS.filter(field=>selected[field]).map(field=><div key={field}><dt>{LOCAL_CONTACT_LABELS[field]}</dt><dd>{selected[field]}</dd></div>)}</dl>
    <div className="row">{!selected.archived&&<Button disabled={pending} onClick={()=>edit(selected)}>Edit contact</Button>}{onInsert&&!selected.archived&&<Button disabled={pending} onClick={()=>{setFields(['name']);go({kind:'preview',contact:selected});}}>Use in message</Button>}<Button kind="text" disabled={pending} onClick={()=>void change({kind:'archive',id:selected.id,archived:!selected.archived})}>{selected.archived?'Restore contact':'Archive contact'}</Button><Button kind="text" disabled={pending} onClick={()=>go({kind:'list'})}>Back to contacts</Button></div>
   </>:<><p>This contact is no longer available.</p><Button onClick={()=>go({kind:'list'})}>Back to contacts</Button></>)}
   {surface.kind==='edit'&&<form className="local-contact-form" onSubmit={event=>{event.preventDefault();if(details.name.trim())void change({kind:'save',...(surface.id?{id:surface.id}:{}),details},surface.expectedRevision);}}>
    <h3>{surface.id?'Edit contact':'Add contact'}</h3>
    <Field label="Name"><input ref={nameInput} value={details.name} maxLength={200} required disabled={pending} onChange={event=>setDetails(value=>({...value,name:event.target.value}))}/></Field>
    <Field label="Email (optional)"><input type="email" value={details.email} maxLength={320} disabled={pending} onChange={event=>setDetails(value=>({...value,email:event.target.value}))}/></Field>
    <Field label="Phone (optional)"><input type="tel" value={details.phone} maxLength={100} disabled={pending} onChange={event=>setDetails(value=>({...value,phone:event.target.value}))}/></Field>
    <Field label="Address (optional)"><textarea rows={3} value={details.address} maxLength={1_000} disabled={pending} onChange={event=>setDetails(value=>({...value,address:event.target.value}))}/></Field>
    <Field label="Notes (optional)"><textarea rows={3} value={details.notes} maxLength={2_000} disabled={pending} onChange={event=>setDetails(value=>({...value,notes:event.target.value}))}/></Field>
    <div className="row"><Button type="submit" disabled={pending||!dirty||!details.name.trim()}>{pending?'Saving…':'Save contact'}</Button><Button disabled={pending} onClick={()=>{clearDraft();go(surface.id?{kind:'detail',id:surface.id}:{kind:'list'});}}>Cancel edits</Button></div>
   </form>}
   {surface.kind==='preview'&&<>
    <h3>Choose details for this message</h3>
    <fieldset className="local-contact-fields" disabled={pending}><legend>Include these fields</legend>{LOCAL_CONTACT_FIELDS.filter(field=>surface.contact[field].trim()).map(field=><label key={field}><input type="checkbox" checked={fields.includes(field)} onChange={event=>setFields(value=>event.target.checked?[...value,field]:value.filter(item=>item!==field))}/>{LOCAL_CONTACT_LABELS[field]}</label>)}</fieldset>
    <p className="tiny">Exact text to insert. You can edit or remove it in your message before sending.</p>
    <pre className="local-contact-preview" aria-label="Contact message preview">{preview||'Choose at least one field.'}</pre>
    <div className="row"><Button disabled={pending||!preview} onClick={()=>void insert()}>{pending?'Checking contact…':'Insert into message'}</Button><Button disabled={pending} onClick={()=>go({kind:'detail',id:surface.contact.id})}>Cancel selection</Button></div>
   </>}
   {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  </>}
 </section>;
}
