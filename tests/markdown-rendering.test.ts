import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {ReadableText,plainExcerpt} from '../src/renderer/src/components/ReadableText';
import {StreamingText} from '../src/renderer/src/components/StreamingText';

describe('saved Markdown rendering',()=>{
 it('retains emphasis semantics in live and saved content',()=>{for(const html of [renderToStaticMarkup(createElement(ReadableText,{text:'**Capacity:** *confirm* ~~old~~'})),renderToStaticMarkup(createElement(StreamingText,{text:'**Capacity:** *confirm* ~~old~~',streaming:true}))]){expect(html).toContain('<strong>Capacity:</strong>');expect(html).toContain('<em>confirm</em>');expect(html).toContain('<del>old</del>');}});
 it('retains ordered and nested lists, quotations, GFM tables and task states',()=>{
  const html=renderToStaticMarkup(createElement(ReadableText,{text:'# Visit plan\n\n3. Check the guide.\n   - Keep the source.\n   - [x] Confirm the date.\n4. Contact the host.\n\n> Capacity still needs confirmation.\n\nName | Places\n--- | ---\nGuests | 12\n\n- [ ] Confirm the count.\n- [x] Read the guide.'}));
  expect(html).toMatch(/<ol\b[^>]*start="3"/);
  expect(html).toMatch(/<ol[^>]*>[\s\S]*<li[^>]*>[\s\S]*<ul[\s\S]*Keep the source/);
  expect(html).toMatch(/<blockquote[\s\S]*Capacity still needs confirmation/);
  expect(html).toContain('<table');
  expect(html).toMatch(/<th[^>]*>Name<\/th>/);
  expect(html).toMatch(/<td[^>]*>12<\/td>/);
  expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  expect(html.match(/checked=""/g)).toHaveLength(2);
  expect(html.match(/disabled=""/g)).toHaveLength(3);
 });

 it('uses the same complete Markdown structure during a stream and after saving',()=>{
  const text='## Plan\n\n1. Read the guide.\n   - Keep the reference.\n2. Confirm the count.\n\n> Keep the missing count explicit.\n\nName | Count\n--- | ---\nGuests | 12\n\n- [ ] Ask the host.\n- [x] Read the date.';
  const stream=renderToStaticMarkup(createElement(StreamingText,{text,streaming:true}));
  const saved=renderToStaticMarkup(createElement(ReadableText,{text}));
  for(const html of [stream,saved]){
   expect(html).toMatch(/<h3>Plan<\/h3>/);
   expect(html).toMatch(/<ol\b[\s\S]*<li>[\s\S]*<ul\b[\s\S]*Keep the reference/);
   expect(html).toMatch(/<blockquote\b[\s\S]*Keep the missing count explicit/);
   expect(html).toMatch(/<table>[\s\S]*<th[^>]*>Name<\/th>[\s\S]*<td[^>]*>12<\/td>/);
   expect(html.match(/type="checkbox"/g)).toHaveLength(2);
   expect(html.match(/checked=""/g)).toHaveLength(1);
   expect(html.match(/disabled=""/g)).toHaveLength(2);
  }
 });

 it('suppresses only a matching leading title visually and retains heading levels',()=>{
  const text='\n# Plan\n\n## Details\n\n### Date\n\n# Plan';
  const suppressed=renderToStaticMarkup(createElement(ReadableText,{text,leadingTitle:'Plan'}));
  expect(suppressed.match(/<h2>Plan<\/h2>/g)).toHaveLength(1);
  expect(suppressed).toContain('<h3>Details</h3>');
  expect(suppressed).toContain('<h4>Date</h4>');
  expect(suppressed).not.toContain('<h1');
  expect(renderToStaticMarkup(createElement(ReadableText,{text})).match(/<h2>Plan<\/h2>/g)).toHaveLength(2);
  expect(renderToStaticMarkup(createElement(ReadableText,{text,leadingTitle:'Other'})).match(/<h2>Plan<\/h2>/g)).toHaveLength(2);
  expect(plainExcerpt('## **Plan**\n\n- [x] Read the `guide`.')).toBe('Plan Read the guide.');
 });

 it('retains the deepest source heading level below the app title',()=>{const html=renderToStaticMarkup(createElement(ReadableText,{text:'##### Fifth\n\n###### Sixth'}));expect(html).toContain('<h6>Fifth</h6>');expect(html).toContain('<h6 aria-level="7">Sixth</h6>');});

 it('renders references honestly while leaving HTML, scripts, remote assets and actions inert',()=>{
  const text='[Visit guide](https://untrusted.invalid/guide)\n\n![Tracking pixel](https://untrusted.invalid/pixel.png)\n\n[Unsafe link](javascript:alert%281%29)\n\n<script>globalThis.markdownExecuted=true</script>\n\n<img src="https://untrusted.invalid/raw.png" onerror="alert(1)">\n\n<iframe src="https://untrusted.invalid/frame"></iframe>\n\n<Widget onClick={alert(1)} />\n\n```js\nfetch("https://untrusted.invalid/code");\n```';
  for(const html of [renderToStaticMarkup(createElement(ReadableText,{text})),renderToStaticMarkup(createElement(StreamingText,{text,streaming:true}))]){
   expect(html).toContain('Visit guide');
   expect(html).toContain('https://untrusted.invalid/guide');
   expect(html).toContain('Image reference: Tracking pixel');
   expect(html).toContain('image not loaded.');
   expect(html).toContain('Unsafe link');
   expect(html).not.toMatch(/<(?:a|img|script|iframe|object|embed|form|button|Widget)\b/);
   expect(html).not.toMatch(/<[^>]*\s(?:href|src|onerror|onclick)=/i);
   expect(html).toContain('<code');
  }
 });
});

it('keeps complete whitespace-preserved plain-text fence bytes and their wrapping language marker in saved notes',()=>{
 const line='  LONG_LINE_BEGIN_'+'x'.repeat(220)+'_LONG_LINE_END  ',html=renderToStaticMarkup(createElement(ReadableText,{text:'```text\n'+line+'\n```'}));
 expect(html).toContain('<pre tabindex="0" role="region" aria-label="Code block">');expect(html).toContain('<code class="language-text">'+line+'\n</code>');
 const code=renderToStaticMarkup(createElement(ReadableText,{text:'```js\nconst value = 1;\n```'}));expect(code).toContain('<code class="language-js">const value = 1;\n</code>');
});
