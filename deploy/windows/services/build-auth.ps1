$env:PATH = "C:\go\bin;" + $env:PATH
$env:GOOS = "windows"
$env:GOARCH = "amd64"

$src = "E:\CK Projects\CitykartDesk\services\auth\src"
$out = "E:\CK Projects\CitykartDesk\services\auth\auth.exe"

if (Test-Path $out) { Remove-Item $out -Force }
Set-Location $src

# Build "." (the repo root, package main), NOT "./cmd" - ./cmd is package cmd,
# a library, not an entry point. Building it produces a valid-looking file at
# the requested output path that is actually a Unix ar-format package archive,
# not an executable (magic bytes "!<arch>\n"). This is correct, deterministic
# Go behavior for a non-main package, not toolchain corruption - it cost a lot
# of debugging time to isolate, so don't reintroduce it.
& go build -o $out .
Write-Host "EXIT=$LASTEXITCODE"

if (Test-Path $out) {
    Write-Host "OUTPUT_SIZE=$((Get-Item $out).Length)"
} else {
    Write-Host "OUTPUT_MISSING"
}
