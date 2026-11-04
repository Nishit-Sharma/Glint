import {expect,type Page} from '@playwright/test';

/** Test the actual contextual navigation; never invoke IPC to bypass UI. */
export async function taskTool(page:Page,name:string){
 const dialog=page.locator('.context-inspector');if(await dialog.isVisible()){await dialog.getByRole('button',{name:'Back to task',exact:true}).click();await expect(dialog).toBeHidden();}
 if(name==='Work')return;
 const label=({Sources:'Context',History:'Activity','Saved work':'Files'} as Record<string,string>)[name]||name;
 await page.locator('.workspace .chrome').getByRole('button',{name:'Task options',exact:true}).click();await page.locator('.workspace .chrome').getByRole('button',{name:label,exact:true}).click();
}
export async function sourceTool(page:Page,name:string){await page.getByRole('button',{name:'Source options',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();}
export async function useScreenContext(page:Page){const button=page.getByRole('button',{name:/^(Use screen context|Choose window)$/,exact:true});if(await button.isVisible())return button.click();await page.getByRole('button',{name:'Request options',exact:true}).click();await button.click();}
