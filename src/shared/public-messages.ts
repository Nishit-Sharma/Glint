import {recurringWorkPublicMessage} from './recurring-work';
import {documentImportMessages} from './document-import';
import {conceptMapPublicMessage} from './concept-map';
import {RESPONSE_PREFERENCES_CHANGED,RESPONSE_PREFERENCES_UNAVAILABLE,RESPONSE_PREFERENCES_CONTEXT_LIMIT} from './response-preferences';
export const RESPONSE_BRANCH_IMAGE_LIMIT = 'This conversation includes embedded image data. Choose an earlier response, or start a new task with selected readable text without image data. Your original task is unchanged.';
export const BROWSER_LAUNCH_UNAVAILABLE = 'Companion could not open its browser. Your task is kept.';
export const BROWSER_PAGE_OPEN_FAILED = 'The selected page could not be opened. Whether it loaded or changed the website is unknown.';
export const BROWSER_ACTION_NOT_RUN = 'The browser action could not be prepared safely. It was not run.';
export const BROWSER_CLEANUP_UNCONFIRMED = 'Browser cleanup could not be confirmed. The page may have loaded or changed the website.';
import {MODULE_EXPORT_RECOVERY,MODULE_REVISION_RECOVERY} from './module-contract';
const browserRecoveryMessages=new Map([
 ['Choice lists in open shadow roots cannot be observed safely yet. Choose another page.', 'This page’s dropdown cannot be read safely yet. Choose another page.'],
 ['This page uses deferred rendering that cannot be observed safely. Choose a narrower page.', 'This page renders content in a way Companion cannot safely read yet. Choose a narrower page.'],
 ['This choice list exceeds the observation limit; choose a narrower page.', 'This dropdown is too large to read safely. Choose a narrower page.'],
 ['This page exceeds the observation limit; choose a narrower page.', 'This page is too large to read safely. Choose a narrower page.'],
 ['This page exceeds the combined observation limit; choose a narrower page.', 'This page is too large to read safely. Choose a narrower page.'],
 ['Too many page controls; choose a narrower page.', 'This page is too large to read safely. Choose a narrower page.'],
 ['This task and page exceed the browser planning limit. Save a checkpoint or choose a narrower page.', 'This task and page are too large to read together. Choose a narrower page.'],
]);
const inspectionRecoveryMessages=new Map([
 ['The task changed while this outcome was being reviewed. Check the action and inspect again if needed.','The task changed during review. Check the action’s current status and inspect again if needed.'],
 ['This action changed while its outcome was being reviewed. Inspect again.','This action changed during review. Inspect its outcome again.'],
 ['The inspected page did not match the selected website. Inspect again.','The inspected page did not match the selected website. Choose the page and inspect again.'],
]);
function browserRecoveryKey(text:string):string|undefined {
 if(browserRecoveryMessages.has(text))return text;
 const evaluation=/^(?:page|elementHandle)\.evaluate: Error: ([^\r\n]+)(?:\r?\n([\s\S]*))?$/.exec(text);
 if(evaluation&&(!evaluation[2]||evaluation[2].split(/\r?\n/).every(line=>/^\s+at\s+[^\r\n]+$/.test(line)))&&browserRecoveryMessages.has(evaluation[1]))return evaluation[1];
 return undefined;
}
function browserRecoveryMessage(text:string):string|undefined {
 const key=browserRecoveryKey(text);return key?browserRecoveryMessages.get(key):undefined;
}
export function browserObservationErrorMessage(error:unknown):string {
 const text=error instanceof Error?error.message:'';
 return browserRecoveryKey(text)??'This page could not be read safely. Whether it loaded or changed the website is unknown.';
}
// Existing saved messages remain readable; only their presentation uses the product name.
const glintCopy = new Map([
 [BROWSER_LAUNCH_UNAVAILABLE, 'Glint could not open its browser. Your task is kept.'],
 ['This page renders content in a way Companion cannot safely read yet. Choose a narrower page.', 'This page renders content in a way Glint cannot safely read yet. Choose a narrower page.'],
 ['This workspace is open in another copy of Companion. Close that copy and try again.', 'This workspace is open in another copy of Glint. Close that copy and try again.'],
 ['Choose an external window. Companion windows cannot be captured.', 'Choose an external window. Glint windows cannot be captured.'],
 ['Allow screen recording for Companion in System Settings, then capture the window again.', 'Allow screen recording for Window Companion in System Settings, then capture the window again.'],
]);
/** Presentation only. Raw failures stay in the local task record for recovery. */
export function publicErrorMessage(error:unknown):string {
 const text=(error&&typeof error==='object'&&'message' in error?String(error.message):String(error??'')).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'').replace(/^Error:\s*/,'').trim();
 const recurring=recurringWorkPublicMessage(text);if(recurring)return recurring;
 const branded=glintCopy.get(text);if(branded)return branded;
 const mapMessage=conceptMapPublicMessage(text);if(mapMessage)return mapMessage;
 const browserRecovery=browserRecoveryMessage(text)??inspectionRecoveryMessages.get(text);
 if(browserRecovery)return glintCopy.get(browserRecovery)??browserRecovery;
 if([...glintCopy.values()].includes(text)||Object.values(documentImportMessages).some(message=>message===text))return text;
 if([RESPONSE_PREFERENCES_CHANGED,RESPONSE_PREFERENCES_UNAVAILABLE,RESPONSE_PREFERENCES_CONTEXT_LIMIT].includes(text)||text===RESPONSE_BRANCH_IMAGE_LIMIT||publicMessages.has(text)||savedWorkMessages.has(text)||text===MODULE_EXPORT_RECOVERY||text===MODULE_REVISION_RECOVERY)return text;
 if(text==='Browser inspection stopped.'||text==='Stopped checking. The earlier action still needs review.')return 'Stopped checking. The earlier action still needs review.';
 if(/native source targeting is unavailable/i.test(text))return 'Drag attachment is unavailable on this device. Press Down Arrow to choose a window.';
 if(/capture setup could not be opened/i.test(text))return 'Capture settings could not be opened. Your saved setup is kept.';
 if(/capture setup|setup (?:appears saved|could not be reconciled)|Finish the setup review/i.test(text))return 'Capture setup needs a new review. Press the screen context shortcut again.';
 if(/capture privacy|Capture privacy|private app update|Private apps changed|verified application identity/.test(text))return 'Capture privacy changed. Snapshots are paused until you review Screen & shortcut settings.';
 if(/screen selection expired/i.test(text))return 'This capture request has ended. Use the screen context shortcut again.';
 if(/website action.*uncertain|earlier action on this site.*uncertain/i.test(text))return 'The website action may have completed. Inspect its outcome before trying another action.';
 if(/executable doesn.t exist|browser runtime.*not installed/i.test(text))return 'Browser support is not installed on this device. Install the browser runtime before trying again.';
 if(/module changed|module state changed|helper changed|answer.*choices changed|task session changed|answer changed.*editing.*module/i.test(text))return 'This answer or your saved choices changed. Review the current version before editing again.';
 if(/remote (?:completion|outcome).*unverified|transport disconnected|stopped waiting/i.test(text))return 'This app stopped waiting. The service may still complete or charge for the request. Check its outcome and usage before sending another request.';
 if(/not authorized.*nothing was sent/i.test(text))return 'This request was not authorized. Nothing was sent.';
 if(/not approved/i.test(text))return 'The export was not approved. No file was saved.';
 if(/uncertain|may have.*(written|saved)|executing.*export/i.test(text))return 'The file may have been saved. Check the destination before trying again.';
 if(/^Invalid join extraction output\./.test(text)||/invalid model draft|unsupported schema|schemaVersion|duplicate JSON|malformed JSON/i.test(text))return 'The response could not be turned into a usable draft. Change your request and try again.';
 if(/invalid experiment|division by zero|matching units|outside bounds/i.test(text)){
  if(/division by zero/i.test(text))return 'This calculation divides by zero. Change the inputs and calculate again.';
  if(/outside bounds/i.test(text))return 'Enter a value within the displayed range.';
  return 'This calculation could not be completed. Review the inputs and units.';
 }
 if(/already exists/i.test(text))return 'A file already exists at this destination. Choose a new filename.';
 if(/another companion|store lock|recovery.*guarded/i.test(text))return 'This workspace is open in another copy of Glint. Close that copy and try again.';
 if(/store.*(unreadable|incompatible|persistence failed)/i.test(text))return 'This workspace could not be opened. Keep its files for recovery and reopen the app.';
 if(/ENOSPC|disk.*full/i.test(text))return 'Your disk is full. Free some space and try again.';
 if(/EACCES|EPERM|permission denied/i.test(text))return 'The app cannot access this file or folder. Choose another location or check its permissions.';
 if(/screen recording|screen capture.*permission/i.test(text))return 'Allow screen recording for Window Companion in System Settings, then capture the window again.';
 if(/selected capture exceeds|image.*exceeds.*8 MiB/i.test(text))return 'This image is too large. Choose a smaller image or resize the source window before capturing it again.';
 if(/references exceed.*32 MiB/i.test(text))return 'The selected snapshots are too large together. Capture smaller source windows before continuing.';
 if(/secure storage.*unavailable/i.test(text))return 'Secure storage is unavailable. Your connection was not saved. Reopen the app and try again.';
 if(/authorize this destination/i.test(text))return 'Confirm where your selected sources will be sent before connecting.';
 if(/API key.*(must|invalid)|unauthenticated|invalid.*key|\b401\b|\b403\b/i.test(text))return 'The connection could not be verified. Check your sign-in or API key in Settings.';
 if(/\b429\b|rate limit|quota|usage limit/i.test(text))return 'This connection has reached its usage limit. Check your account or choose another connection.';
 if(/provider availability.*unverified|unconfigured|not configured|no.*(credential|connection)/i.test(text))return 'Connect an AI service in Settings before sending a request.';
 if(/incomplete|ended.*before|closed.*before.*response.*finished|partial response/i.test(text))return 'The response was incomplete. Check your connection before trying again.';
 if(/offline|disconnect|ECONN|network|fetch failed|timeout|timed out|stalled|\b50[0234]\b/i.test(text))return 'The connection was interrupted. Check your connection before trying again.';
 if(/refresh|source changed|capture.*(expired|consumed)|snapshot.*expired|rebind|document token/i.test(text))return 'Refresh the selected window before asking again, and review any changed sources.';
 if(/window.*unavailable|ENOENT/i.test(text))return 'This file or window is no longer available. Choose it again.';
 if(/artifact changed|procedure changed|newer.*revision/i.test(text))return 'A newer version is available. Load it before saving or requesting changes.';
 if(/source.*not found/i.test(text))return 'This source is no longer available. Add it again before continuing.';
 if(/artifact.*not found|missing revision/i.test(text))return 'This saved item is no longer available. Return to the task and choose another item.';
 if(/resume the task/i.test(text))return 'Resume the task before continuing.';
 if(/cancelled|canceled|stopped|connection changed/i.test(text))return 'The request stopped. Review the task before starting another request.';
 if(/proposal changed|approval.*(required|retired)|approved proposal|destination.*changed|bytes.*(differ|match)/i.test(text))return 'This export needs a new review. Check the draft and destination before approving it again.';
 if(/shortcut/i.test(text))return 'Choose an available shortcut, such as Control+Shift+Space.';
 if(/source ID|source kind|source role/i.test(text))return 'Choose a valid source before continuing.';
 if(/unknown.*(command|type)|Unknown companion command|unsupported request/i.test(text))return 'This action is not available. Reopen the app and try again.';
 if(/must contain.*characters/i.test(text))return 'Complete the required fields and keep the text within the displayed limits.';
 return 'This action could not be completed. Review the task before continuing.';
}

/** Connection checks can fail without rejecting IPC. Never display their diagnostic detail. */
export function connectionIssueMessage(detail:string):string {
 if(/signed-in|sign.in|login/i.test(detail))return 'Open Codex and sign in, then check the connection.';
 if(/does not advertise GPT-6 Luna|Luna.*not advertised|reasoning setting.*not supported/i.test(detail))return 'Luna with the required settings is not available for this account. Choose another connection or check your Codex access.';
 if(/CLI|could not be started|availability could not be verified/i.test(detail))return 'Codex could not be opened. Open or update Codex, then check the connection.';
 if(/disconnected in this app/i.test(detail))return 'This connection is turned off. Choose it again to reconnect.';
 return publicErrorMessage(detail);
}

export function requestStatusLabel(status:string){return ({running:'Working',completed:'Completed',failed:'Could not complete',cancelled:'Stopped',interrupted:'Interrupted'} as Record<string,string>)[status]??'Needs attention';}
export function sourceRoleLabel(role:string){return ({fact:'Source material',style:'Style reference',inspiration:'Inspiration'} as Record<string,string>)[role]??'Reference';}

// Exact allowlist: repeated formatting cannot turn a safe message into a generic one.
const savedWorkMessages=new Set([
 'This match changed or is no longer available. Search again to choose current saved work.',
 'Saved work changed while opening. Search again to choose from the current task list.',
 'This saved task is no longer available. Search again.',
]);
const publicMessages=new Set([...browserRecoveryMessages.values(),BROWSER_ACTION_NOT_RUN,...inspectionRecoveryMessages.values(),'This page could not be read safely. Whether it loaded or changed the website is unknown.',BROWSER_LAUNCH_UNAVAILABLE,BROWSER_PAGE_OPEN_FAILED,BROWSER_CLEANUP_UNCONFIRMED,'Drag attachment is unavailable on this device. Press Down Arrow to choose a window.','This saved helper changed or is no longer available. Refresh Saved helpers and choose it again.','The saved text helper changed. Open its current version from Files.','This text helper is still being saved. Reopen Files after it finishes.','Choose an external window. Companion windows cannot be captured.','Capture settings could not be opened. Your saved setup is kept.','Window snapshots are supported on macOS. This platform is untested.','Capture setup needs a new review. Press the screen context shortcut again.','Capture privacy changed. Snapshots are paused until you review Screen & shortcut settings.','This app is private. Its windows cannot be captured or sent.','This app could not be compared with your private apps. Capture is blocked.','This window is known to be protected. Capture is blocked.',"Your message could not be saved on this Mac. Keep a copy before closing.", "This capture request has ended. Use the screen context shortcut again.", "Automatic page redirects are not supported in this browser yet. Open the final page address and try again.", "Switch to the window you want to use, then press the screen context shortcut again.", "This app stopped waiting. The service may still complete or charge for the request. Check its outcome and usage before sending another request.", "This request was not authorized. Nothing was sent.", "The export was not approved. No file was saved.", "The file may have been saved. Check the destination before trying again.", "The response could not be turned into a usable draft. Change your request and try again.", "This calculation divides by zero. Change the inputs and calculate again.", "Enter a value within the displayed range.", "This calculation could not be completed. Review the inputs and units.", "A file already exists at this destination. Choose a new filename.", "This workspace is open in another copy of Companion. Close that copy and try again.", "This workspace could not be opened. Keep its files for recovery and reopen the app.", "Your disk is full. Free some space and try again.", "The app cannot access this file or folder. Choose another location or check its permissions.", "Allow screen recording for Companion in System Settings, then capture the window again.", "This image is too large. Choose a smaller image or resize the source window before capturing it again.", "The selected snapshots are too large together. Capture smaller source windows before continuing.", "Secure storage is unavailable. Your connection was not saved. Reopen the app and try again.", "Confirm where your selected sources will be sent before connecting.", "The connection could not be verified. Check your sign-in or API key in Settings.", "This connection has reached its usage limit. Check your account or choose another connection.", "Connect an AI service in Settings before sending a request.", "The response was incomplete. Check your connection before trying again.", "The connection was interrupted. Check your connection before trying again.", "Refresh the selected window before asking again, and review any changed sources.", "This file or window is no longer available. Choose it again.", "A newer version is available. Load it before saving or requesting changes.", "This source is no longer available. Add it again before continuing.", "This saved item is no longer available. Return to the task and choose another item.", "Resume the task before continuing.", "The request stopped. Review the task before starting another request.", "This export needs a new review. Check the draft and destination before approving it again.", "Choose an available shortcut, such as Control+Shift+Space.", "Choose a valid source before continuing.", "This action is not available. Reopen the app and try again.", "Complete the required fields and keep the text within the displayed limits.", "This action could not be completed. Review the task before continuing.", "Open Codex and sign in, then check the connection.", "Luna with the required settings is not available for this account. Choose another connection or check your Codex access.", "Codex could not be opened. Open or update Codex, then check the connection.", "This connection is turned off. Choose it again to reconnect."]);
