$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$originalPath = $env:PATH
Push-Location $projectRoot
try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This script builds the Windows executable. Run it on Windows.' }
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCommand) { throw 'Node.js/npm is missing. Install Node.js, then run npm ci in the project directory.' }
    if (-not (Test-Path -LiteralPath 'node_modules/typescript/bin/tsc')) { throw 'Dependencies are missing. Run npm ci first.' }

    $cargoCommand = Get-Command cargo.exe -ErrorAction SilentlyContinue
    if ($cargoCommand) {
        $cargoPath = $cargoCommand.Source
    } else {
        $cargoRoot = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE '.cargo' }
        $cargoPath = Join-Path $cargoRoot 'bin/cargo.exe'
        if (-not (Test-Path -LiteralPath $cargoPath)) { throw 'Rust/Cargo is missing. Install Rust MSVC and Microsoft C++ Build Tools first.' }
    }
    $env:PATH = "$(Split-Path -Parent $cargoPath);$originalPath"
    $config = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    $package = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.version -ne $package.version) { throw 'package.json and tauri.conf.json versions do not match.' }

    Write-Host '[1/4] Checking and testing the frontend...'
    & $npmCommand.Source run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed.' }
    & $npmCommand.Source test
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed.' }

    Write-Host '[2/4] Testing native commands...'
    & $cargoPath test --locked --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Native tests failed.' }

    Write-Host '[3/4] Building frontend assets...'
    & $npmCommand.Source run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }

    Write-Host '[4/4] Building the release EXE with embedded assets...'
    # custom-protocol embeds dist/ instead of loading the development server.
    # Cargo's artifact report also handles custom target directories correctly.
    $buildMessages = & $cargoPath build --locked --release --manifest-path src-tauri/Cargo.toml --features tauri/custom-protocol --message-format=json-render-diagnostics
    if ($LASTEXITCODE -ne 0) { throw 'Native build failed. Check Rust MSVC and Microsoft C++ Build Tools.' }
    $executable = $null
    foreach ($line in $buildMessages) {
        $message = $line | ConvertFrom-Json
        if ($message.reason -eq 'compiler-artifact' -and $message.target.name -eq 'jianmo' -and $message.executable) {
            $executable = $message.executable
        }
    }
    if (-not $executable -or -not (Test-Path -LiteralPath $executable) -or [IO.Path]::GetExtension($executable) -ne '.exe') {
        throw 'Cargo did not produce a Windows Jianmo executable.'
    }

    $outputDirectory = Join-Path $projectRoot 'release'
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $outputPath = Join-Path $outputDirectory "Jianmo-$($config.version).exe"
    Copy-Item -LiteralPath $executable -Destination $outputPath -Force
    $checksum = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$outputPath.sha256" -Encoding ASCII -Value "$checksum  $([IO.Path]::GetFileName($outputPath))"
    Write-Host ''
    Write-Host "EXE: $outputPath"
    Write-Host "SHA256: $checksum"
    Write-Host 'Build complete. The EXE needs Windows WebView2 Runtime; no local web server is required.'
} catch {
    Write-Host "Build failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    $env:PATH = $originalPath
    Pop-Location
}
