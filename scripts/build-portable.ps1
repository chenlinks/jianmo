$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    & node node_modules/typescript/bin/tsc --noEmit
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed' }
    # Native CLI avoids a nested Node process launcher in restricted Windows environments.
    & '.\node_modules\@esbuild\win32-x64\esbuild.exe' src/main.tsx --bundle --outfile=dist/app.js --format=iife --platform=browser --jsx=automatic --loader:.css=text --define:process.env.NODE_ENV="'production'" --minify
    if ($LASTEXITCODE -ne 0) { throw 'Bundling failed' }
    & node scripts/assemble-portable.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Assembly failed' }
} finally { Pop-Location }
