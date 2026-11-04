import {trayImage} from './tray-image'

type TrayImageTarget={addRepresentation(options:{scaleFactor:number,width:number,height:number,dataURL:string}):void,setTemplateImage(option:boolean):void}

/** Menu-bar image from the generated @1x/@2x pair; on macOS it is a template image so the system tints it for light/dark bars. */
export function createTrayImage<T extends TrayImageTarget>(createEmpty:()=>T,platform:NodeJS.Platform):T{
  const image=createEmpty()
  for(const [scaleFactor,dataURL] of [[1,trayImage.x1],[2,trayImage.x2]] as const)image.addRepresentation({scaleFactor,width:trayImage.width,height:trayImage.height,dataURL})
  if(platform==='darwin')image.setTemplateImage(true)
  return image
}
