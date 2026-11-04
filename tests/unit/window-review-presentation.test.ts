import {initialWindowReviewForm} from '../../src/renderer/src/window-review-form';
import {expect,test} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkflowSourceCitations} from '../../src/renderer/src/components/WorkflowSourceCitations';
import {reviewedWindowFixture} from '../support/window-review-repair.fixture';
import {workflowLab} from '../../src/learning/workflow-lab';

test('region-only image corrections expose original and reviewed region, quote, classification and reason in live and readable projections',()=>{
 const {data,state}=reviewedWindowFixture(),html=renderToStaticMarkup(createElement(WorkflowSourceCitations,{citations:data.citations,sourceName:()=> 'Owned synthetic window'})),text=workflowLab.text(data,state);
 for(const output of [html,text])for(const literal of ['Reviewed normalized region: 0.5, 0.25, 0.25, 0.25','Original proposed normalized region: 0.1, 0.1, 0.2, 0.2','corrected-transcription','I corrected only the selected image region.','Idle'])expect(output).toContain(literal);
});

import {learningDraftFormName} from '../../src/renderer/src/learning-draft-context';
test('Files distinguishes proposal, image review and finite publication drafts while keeping legacy labels',()=>{
 expect(learningDraftFormName('window-workflow:proposal')).toBe('State transition proposal');
 expect(learningDraftFormName('window-workflow:review:owned-candidate')).toBe('State transition review');
 expect(learningDraftFormName('window-workflow:publication:owned-candidate')).toBe('Finite experiment publication');
 expect(learningDraftFormName('workflow:prediction:practice')).toBe('Prediction');expect(learningDraftFormName('join:keys')).toBe('Join keys');
});

import {WindowProposedName,WindowProposedInitialState} from '../../src/renderer/src/components/WindowProposalDetails';
import {inferredWindowCandidate} from '../support/window-review-repair.fixture';
test('inferred names preserve the original reason and quote IDs beside the editable interpretation',()=>{const candidate=inferredWindowCandidate(),html=renderToStaticMarkup(createElement(WindowProposedName,{entry:candidate.proposal.states[0]}));expect(html).toContain('inferred');expect(html).toContain('The ambiguous handwritten label may be Idle.');expect(html).toContain('c-idle');});
test('the original inferred starting choice remains visible without becoming the local starting choice',()=>{const candidate=inferredWindowCandidate(),html=renderToStaticMarkup(createElement(WindowProposedInitialState,{candidate}));expect(html).toContain('idle');expect(html).toContain('The incoming arrow appears to indicate the initial state.');expect(html).toContain('c-idle');expect(initialWindowReviewForm(candidate).initialStateId).toBe('');});

import {WindowQuotedText} from '../../src/renderer/src/components/WindowProposalDetails';
test('image quote projections preserve exact repeated spaces, tabs and newlines and mark content for wrapping',()=>{
 const quote='Idle  +\tStart\n-> Busy',candidate=inferredWindowCandidate(),f=reviewedWindowFixture('owned-task',undefined,candidate),reviewHtml=renderToStaticMarkup(createElement(WindowQuotedText,{text:quote})),labHtml=renderToStaticMarkup(createElement(WorkflowSourceCitations,{citations:f.data.citations,sourceName:()=> 'Owned synthetic window'}));
 expect(reviewHtml).toContain('window-review-quote');expect(reviewHtml).toContain('Idle  +\tStart\n-&gt; Busy');expect(labHtml).toContain('workflow-image-citation');expect(labHtml).toContain('Idle  +\tStart\n-&gt; Busy');expect(workflowLab.text(f.data,f.state)).toContain(quote);
});

import {lexer} from 'marked';
import {canEditRichText} from '../../src/renderer/src/document-format';
test('readable image notes use literal quote blocks so Markdown preserves source whitespace',()=>{const quote='Idle  +\tStart\n-> Busy',candidate=inferredWindowCandidate(),f=reviewedWindowFixture('owned-task',undefined,candidate),notes=workflowLab.text(f.data,f.state),blocks=lexer(notes).filter(token=>token.type==='code'&&token.lang==='window-transcription'&&token.text===quote);expect(blocks).toHaveLength(2);expect(canEditRichText(notes)).toBe(true);});

import {ReadableText} from '../../src/renderer/src/components/ReadableText';
test('the actual readable Markdown viewer retains literal transcription quote blocks and their scoped class',()=>{const f=reviewedWindowFixture('owned-task',undefined,inferredWindowCandidate()),html=renderToStaticMarkup(createElement(ReadableText,{text:workflowLab.text(f.data,f.state)}));expect(html).toContain('language-window-transcription');expect(html).toContain('Idle  +\tStart\n-&gt; Busy');expect(html).toContain('<pre');});
