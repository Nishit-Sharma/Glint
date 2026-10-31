export const CODE_BLOCK_COPY_LIMIT=1024*1024;
export type CodeBlockCopyCommand={type:'code-block.copy';text:string};

export function readCodeBlockCopy(value:unknown):CodeBlockCopyCommand{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Code could not be copied.');
 const input=value as Record<string,unknown>;
 if(input.type!=='code-block.copy'||Object.keys(input).some(key=>key!=='type'&&key!=='text')||typeof input.text!=='string'||input.text.length>CODE_BLOCK_COPY_LIMIT)throw Error('Code could not be copied.');
 return {type:'code-block.copy',text:input.text};
}

export function writeCodeBlockCopy(value:unknown,writeText:(text:string)=>void):null{
 const input=readCodeBlockCopy(value);
 writeText(input.text);
 return null;
}
