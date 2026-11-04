export function evictHostFixture(loadHost:NodeRequire,outfile:string):void{delete loadHost.cache[loadHost.resolve(outfile)];}
