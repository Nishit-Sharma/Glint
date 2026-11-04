import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {TaskSidebar} from '../../src/renderer/src/components/TaskSidebar';
import type {Task} from '../../src/core/types';

it('marks and orders a pinned task while retaining exact task button names and navigation controls',()=>{
 const empty={goal:'',status:'active' as const,createdAt:'2026-10-20',sources:[],artifacts:[],requests:[],procedures:[],checkpoints:[],actions:[],memory:{enabled:false as const}},tasks:Task[]=[{...empty,id:'recent',title:'Recent task',updatedAt:'2026-10-29'},{...empty,id:'important',title:'Ongoing project',updatedAt:'2026-10-20'}];
 const html=renderToStaticMarkup(createElement(TaskSidebar,{character:null,tasks,pinnedTaskIds:['important'],onSelectTask:()=>{},onCreateTask:()=>{},onSettings:()=>{}}));
 expect(html.indexOf('aria-label="Ongoing project"')).toBeLessThan(html.indexOf('aria-label="Recent task"'));expect(html).toContain('aria-description="Pinned task"');expect(html).toContain('New task');expect(html).toContain('Settings');
});
