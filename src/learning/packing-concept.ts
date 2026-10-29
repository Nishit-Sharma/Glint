/** One reviewed line only. Capacity describes items per box; no surrounding policy is inferred. */
export function parsePackingCapacity(quote:string):number|null{
 const match=/^([1-9][0-9]{0,2}|1000) items per box$/i.exec(quote);return match?Number(match[1]):null;
}
export function packingResult(capacity:number,count:number){
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>1000||!Number.isSafeInteger(count)||count<0||count>10000)throw Error('Use a capacity of 1–1,000 and an item count of 0–10,000.');
 const full=Math.floor(count/capacity),remaining=count%capacity,boxes=full+(remaining>0?1:0);return {capacity,count,full,remaining,boxes};
}
const boxes=(n:number)=>n===1?'box':'boxes';
export function packingDocument(quote:string,count:number){
 const capacity=parsePackingCapacity(quote);if(capacity===null)throw Error('Choose a supported capacity line.');const selected=packingResult(capacity,count),baseline=packingResult(capacity,capacity);
 return `# Packing ${count} items\n\n## Reviewed source line\n\n\`${quote}\`\n\nOnly this line is reviewed. The item counts below are hypothetical; no current inventory or packing policy is inferred.\n\n## Assumptions\n\nEach box holds exactly ${capacity} items when full. Items are identical and indivisible. A partially filled box is allowed when items remain. No other constraints are modeled.\n\n## Compare item counts\n\nBaseline: ${capacity} items fill ${baseline.full} box, leave ${baseline.remaining} items, and need ${baseline.boxes} box.\n\nChanged count: ${count} items make ${selected.full} full ${boxes(selected.full)} with ${selected.remaining} items left. ${selected.remaining>0?'Those remaining items need one partial box.':'No partial box is needed.'} Total boxes needed: ${selected.boxes}.\n\nCalculation: ${count} = ${selected.full} × ${capacity} + ${selected.remaining}; ${selected.full} full ${boxes(selected.full)} + ${selected.remaining>0?1:0} partial ${boxes(selected.remaining>0?1:0)} = ${selected.boxes} ${boxes(selected.boxes)}.\n\nThis is a bounded arithmetic model, not a check of real stock or an actual packing operation. Reopen the source document to review another count and save it separately.\n`;
}
