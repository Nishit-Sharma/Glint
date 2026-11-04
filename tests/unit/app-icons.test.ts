import {describe,expect,it} from 'vitest'
import {readFileSync,existsSync} from 'node:fs'
import {inflateSync} from 'node:zlib'
import {createTrayImage} from '../../src/host/tray-icon'
import {trayImage} from '../../src/host/tray-image'

// Minimal PNG reader (8-bit RGBA, non-interlaced) for the generated icon assets.
function png(bytes:Buffer){
  expect(bytes.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
  let at=8,width=0,height=0,colorType=-1;const data:Buffer[]=[]
  while(at<bytes.length){const len=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),body=bytes.subarray(at+8,at+8+len)
    if(type==='IHDR'){width=body.readUInt32BE(0);height=body.readUInt32BE(4);colorType=body[9]}if(type==='IDAT')data.push(body);at+=12+len}
  return {width,height,colorType,rgba:colorType===6?unfilter(inflateSync(Buffer.concat(data)),width,height):undefined}
}
// Undo PNG scanline filters (bpp 4) so pixels can be checked exactly.
function unfilter(raw:Buffer,width:number,height:number){
  const stride=width*4,out=Buffer.alloc(stride*height)
  for(let y=0;y<height;y++){const type=raw[y*(stride+1)];for(let x=0;x<stride;x++){
    const v=raw[y*(stride+1)+1+x],a=x>=4?out[y*stride+x-4]:0,b=y?out[(y-1)*stride+x]:0,c=x>=4&&y?out[(y-1)*stride+x-4]:0
    const pa=Math.abs(b-c),pb=Math.abs(a-c),pc=Math.abs(a+b-2*c),paeth=pa<=pb&&pa<=pc?a:pb<=pc?b:c
    out[y*stride+x]=(v+[0,a,b,(a+b)>>1,paeth][type])&255}}
  return out
}
const fromDataUrl=(url:string)=>{expect(url.startsWith('data:image/png;base64,')).toBe(true);return Buffer.from(url.split(',')[1],'base64')}

describe('menu-bar tray image',()=>{
  it('is built from the @1x and @2x pair and marked as a template on macOS',()=>{
    const reps:{scaleFactor:number,width:number,height:number,dataURL:string}[]=[],template:boolean[]=[]
    const image=createTrayImage(()=>({addRepresentation:(r:typeof reps[number])=>void reps.push(r),setTemplateImage:(v:boolean)=>void template.push(v)}),'darwin')
    expect(image).toBeDefined()
    expect(reps.map(r=>[r.scaleFactor,r.width,r.height])).toEqual([[1,16,16],[2,16,16]])
    expect(reps.map(r=>r.dataURL)).toEqual([trayImage.x1,trayImage.x2])
    expect(template).toEqual([true])
    const marked:boolean[]=[];createTrayImage(()=>({addRepresentation:()=>{},setTemplateImage:(v:boolean)=>void marked.push(v)}),'linux');expect(marked).toEqual([])
  })
  it('ships black-plus-alpha template pixels at 16 and 32 px, matching the build/tray Template files',()=>{
    for(const [url,size,file] of [[trayImage.x1,16,'build/tray/glintTemplate.png'],[trayImage.x2,32,'build/tray/glintTemplate@2x.png']] as const){
      const bytes=fromDataUrl(url),p=png(bytes);expect([p.width,p.height,p.colorType]).toEqual([size,size,6])
      expect(readFileSync(file).equals(bytes)).toBe(true)
      // template images must carry no colour, only alpha
      const px=p.rgba!;let opaque=0
      for(let i=0;i<px.length;i+=4)if(px[i+3]){opaque++;expect([px[i],px[i+1],px[i+2]]).toEqual([0,0,0])}
      expect(opaque).toBeGreaterThan(size*size/4)
      if(size===16){const alpha=(x:number,y:number)=>px[(y*16+x)*4+3]
        // hinted @1x eyes: fully clear 1x3 px holes at columns 5 and 10, rows 6-8, with opaque body beside them
        for(const x of [5,10])for(const y of [6,7,8]){expect(alpha(x,y)).toBe(0);expect(alpha(x-1,y)).toBe(255);expect(alpha(x+1,y)).toBe(255)}}
    }
  })
})

describe('app icon',()=>{
  it('packages build/companion.icns and a complete iconset at the expected sizes',()=>{
    const pkg=JSON.parse(readFileSync('package.json','utf8'))
    expect(pkg.build.mac.icon).toBe('build/companion.icns')
    const icns=readFileSync('build/companion.icns');expect(icns.toString('ascii',0,4)).toBe('icns');expect(icns.readUInt32BE(4)).toBe(icns.length)
    const sizes:[string,number][]=[['16x16',16],['16x16@2x',32],['32x32',32],['32x32@2x',64],['128x128',128],['128x128@2x',256],['256x256',256],['256x256@2x',512],['512x512',512],['512x512@2x',1024]]
    for(const [name,px] of sizes){const file=`build/companion.iconset/icon_${name}.png`;expect(existsSync(file)).toBe(true);const p=png(readFileSync(file));expect([p.width,p.height]).toEqual([px,px])}
    expect(readFileSync('build/companion-icon.png').equals(readFileSync('build/companion.iconset/icon_512x512@2x.png'))).toBe(true)
  })
})
