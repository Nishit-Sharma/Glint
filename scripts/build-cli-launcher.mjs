import {mkdir,writeFile} from 'node:fs/promises';

await mkdir('out/native',{recursive:true});
await writeFile('out/native/glint',`#!/bin/sh
set -eu
unset NODE_OPTIONS NODE_PATH ELECTRON_RUN_AS_NODE ELECTRON_NO_ASAR ELECTRON_ENABLE_LOGGING ELECTRON_LOG_FILE ELECTRON_OVERRIDE_DIST_PATH ELECTRON_FORCE_IS_PACKAGED DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH LD_PRELOAD LD_LIBRARY_PATH
cli_dir=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
contents=$(CDPATH= cd -P -- "$cli_dir/../../../.." && pwd)
export ELECTRON_RUN_AS_NODE=1
exec /usr/bin/env -i ELECTRON_RUN_AS_NODE=1 LANG=en_US.UTF-8 "$contents/MacOS/Glint" "$cli_dir/../main/cli.js" "$@"
`,{mode:0o755});
