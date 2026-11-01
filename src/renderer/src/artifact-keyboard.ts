/** Native F6 region traversal. Only explicit keyboard input moves focus. */
export function cycleArtifactRegion(root:HTMLElement,reverse:boolean):string|undefined{
 const regions=[...root.querySelectorAll<HTMLElement>('[data-artifact-region]')].filter(element=>!element.closest('[hidden],[inert],details:not([open])')&&!!element.getClientRects().length);
 if(!regions.length)return;
 let current=-1;regions.forEach((element,index)=>{if(element===document.activeElement||element.contains(document.activeElement))current=index;});const index=current<0?(reverse?regions.length-1:0):(current+(reverse?-1:1)+regions.length)%regions.length,target=regions[index];
 const focusTarget=target.tagName==='HEADER'?target.querySelector<HTMLElement>('button'):target;if(!focusTarget)return;
 focusTarget.focus({preventScroll:true});focusTarget.scrollIntoView({block:'nearest'});return target.dataset.artifactRegion;
}
