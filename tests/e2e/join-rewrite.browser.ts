import {expect,test} from '@playwright/test';

test('bounded rewrite inspection stays local, resets after edits and fits narrow and wide views',async({page})=>{
 const errors:string[]=[],external:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&url.port==='4532')return route.continue();external.push(url.href);return route.abort();});
 await page.goto('/learning-demo.html');
 const open=()=>page.getByText('Check a join rewrite',{exact:true}),scope=()=>page.getByRole('region',{name:'Bounded join rewrite check',exact:true});
 await expect(open()).toHaveCount(0);
 await page.getByLabel('Predict the output row count',{exact:true}).fill('2');await page.getByRole('button',{name:'Check prediction',exact:true}).click();
 await open().click();await expect(scope()).toBeVisible();
 const before=await page.evaluate(()=>JSON.stringify(localStorage));
 await scope().getByRole('button',{name:'Search bounded cases',exact:true}).click();
 await expect(scope().getByRole('status')).toHaveText('Counterexample found after 1 checked case(s).');
 await expect(scope()).toContainText('Applied condition: 2 output rows. Proposed rewrite: 4 output rows.');
 await scope().getByText('Inspect exact counterexample tables and results',{exact:true}).click();
 await expect(scope().getByRole('region',{name:'Proposed rewrite result',exact:true}).getByText('Unmatched (NULL)',{exact:true})).toHaveCount(2);
 for(const [width,height] of [[1080,800],[360,640]]){
  await page.setViewportSize({width,height});await scope().getByRole('button',{name:'Search bounded cases',exact:true}).scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath(`rewrite-${width}.png`),fullPage:false});
 }
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).toBe(before);
 await scope().getByLabel('Proposed join type',{exact:true}).selectOption('INNER');
 await expect(scope().getByLabel('Join rewrite result',{exact:true})).toHaveCount(0);
 await scope().getByRole('button',{name:'Search bounded cases',exact:true}).focus();await page.keyboard.press('Enter');
 await expect(scope().getByRole('status')).toContainText('No counterexample found within');
 await expect(scope().getByRole('status')).toContainText('This is not proof of equivalence.');
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).toBe(before);
 await page.reload();await open().click();await expect(scope().getByLabel('Join rewrite result',{exact:true})).toHaveCount(0);
 await page.getByLabel('Join type',{exact:true}).selectOption('LEFT');await expect(open()).toHaveCount(0);
 await page.getByLabel('Predict the output row count',{exact:true}).fill('4');await page.getByRole('button',{name:'Check prediction',exact:true}).click();await open().click();
 await scope().getByRole('button',{name:'Search bounded cases',exact:true}).click();await expect(scope()).toContainText('Applied revision 3.');
 await page.getByRole('button',{name:'Try separate challenge',exact:true}).click();await expect(open()).toHaveCount(0);
 await page.getByLabel('Predict the output row count',{exact:true}).fill('6');await page.getByRole('button',{name:'Check prediction',exact:true}).click();await open().click();
 await expect(scope()).toContainText('Shipments.Dock');await expect(scope()).not.toContainText('Members.Team');
 expect(errors).toEqual([]);expect(external).toEqual([]);
});
test('incompatible alternative keys disable comparison, and a compatible edit clears old results',async({page})=>{
 await page.goto('/learning-demo.html?fixture=mixed');
 await page.getByLabel('Predict the output row count',{exact:true}).fill('3');await page.getByRole('button',{name:'Check prediction',exact:true}).click();
 await page.getByText('Check a join rewrite',{exact:true}).click();const scope=page.getByRole('region',{name:'Bounded join rewrite check',exact:true});
 await scope.getByRole('button',{name:'Search bounded cases',exact:true}).click();
 await scope.getByLabel('Proposed left key',{exact:true}).selectOption('p-number');
 await expect(scope.getByLabel('Join rewrite result',{exact:true})).toHaveCount(0);await expect(scope.getByRole('button',{name:'Search bounded cases',exact:true})).toBeDisabled();
 await expect(scope).toContainText('Choose keys with the same declared type.');
 await scope.getByLabel('Proposed right key',{exact:true}).selectOption('p-rnumber');
 await expect(scope.getByRole('button',{name:'Search bounded cases',exact:true})).toBeEnabled();
 await scope.getByRole('button',{name:'Search bounded cases',exact:true}).click();await expect(scope.getByLabel('Join rewrite result',{exact:true})).toContainText('Counterexample found');
});
