import {expect,type Page} from '@playwright/test';

/** Visibility alone does not mean the authentic reveal has handed off its pixels. */
export async function settleCapture(page:Page){
 await expect(page.locator('[data-runtime-scope="whole-surface"]:visible').first()).toHaveAttribute('data-surface-reveal',/^(settled|skipped|cancelled)$/);
 await expect(page.locator('.t-gen,.t-tig')).toHaveCount(0);
 await expect(page.getByText('Opening interactive answer…',{exact:true})).toHaveCount(0);
 await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(image=>image.getClientRects().length>0).map(image=>image.decode().catch(()=>{})));await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
}
