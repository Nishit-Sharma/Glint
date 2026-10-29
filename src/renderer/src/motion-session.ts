/** Explicit host presentation openings renew entrance; tabs never do. */
export class PresentationSession {
 private claimed=false;
 private leaving=false;
 private terminal=false;
 entranceVersion=0;
 private listeners=new Set<()=>void>();
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 snapshot=()=>this.entranceVersion;
 get exiting(){return this.leaving||this.terminal;}
 get startupAvailable(){return !this.claimed&&!this.exiting;}
 claimStartup(version=this.entranceVersion){if(version!==this.entranceVersion||!this.startupAvailable)return false;this.claimed=true;return true;}
 beginEntrance(){if(this.terminal)return false;this.entranceVersion++;this.claimed=false;this.leaving=false;for(const listener of this.listeners)listener();return true;}
 beginExit(terminal=true){const wasExiting=this.exiting;this.claimed=true;this.leaving=true;if(terminal)this.terminal=true;if(!wasExiting)for(const listener of this.listeners)listener();}
 endPresentationExit(){if(!this.terminal&&this.leaving){this.leaving=false;for(const listener of this.listeners)listener();}}
}
