import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,test} from 'vitest';
import {ModuleView} from '../../src/renderer/src/components/InteractiveModule';
import {exampleLesson} from '../../src/learning/example';
import {joinLab} from '../../src/learning/join-lab';
import {helperExample} from '../../src/learning/helper-example';
import {helperStudio} from '../../src/learning/reusable-helper';

test('semantically invalid saved lesson state renders review without silently resetting it',()=>{
 const saved={...joinLab.initial(exampleLesson),source:{...exampleLesson.source,digest:'old-source'}};
 const output=renderToStaticMarkup(createElement(ModuleView,{data:exampleLesson,state:saved,onAction:()=>{throw Error('No action should be emitted.');}}));
 expect(output).toContain('needs review');expect(output).toContain('Your saved work is kept');
 expect(saved.source.digest).toBe('old-source');
});
test('saved helper state from another identity also renders the same review boundary',()=>{
 const saved={...helperStudio.initial(helperExample),helperId:'different-helper'};
 expect(renderToStaticMarkup(createElement(ModuleView,{data:helperExample,state:saved,onAction:()=>{}}))).toContain('needs review');
});
