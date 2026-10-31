import {LOCAL_CONTACT_LIMIT,type LocalContacts,type LocalContactsChange} from '../shared/local-contacts';

export function changeLocalContacts(current:LocalContacts,change:LocalContactsChange['change'],identity:{id:string;time:string}):LocalContacts{
 if(current.revision===Number.MAX_SAFE_INTEGER)throw Error('Contacts revision limit reached. Saved contacts are preserved.');
 const next={...structuredClone(current),revision:current.revision+1};
 const previous='id' in change&&change.id?next.contacts.find(contact=>contact.id===change.id):undefined;
 if(change.id&&!previous)throw Error('This local contact is no longer available. Reload contacts before editing.');
 if(change.kind==='archive'){
  if(!previous)throw Error('This local contact is no longer available.');
  next.contacts[next.contacts.indexOf(previous)]={...previous,archived:change.archived,revision:next.revision,updatedAt:identity.time};
 }else{
  if(previous?.archived)throw Error('Restore this contact before editing it.');
  if(!previous&&next.contacts.length>=LOCAL_CONTACT_LIMIT)throw Error(`Keep at most ${LOCAL_CONTACT_LIMIT} local contacts, including archived contacts.`);
  const {name,email,phone,address,notes}=change.details;
  const contact={id:previous?.id??identity.id,revision:next.revision,name:name.trim(),email:email.trim(),phone:phone.trim(),address:address.trim(),notes:notes.trim(),archived:false,createdAt:previous?.createdAt??identity.time,updatedAt:identity.time};
  if(previous)next.contacts[next.contacts.indexOf(previous)]=contact;else next.contacts.push(contact);
 }
 return next;
}
