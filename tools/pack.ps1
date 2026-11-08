# Builds JetseoNewsExtension-<version>.zip next to the repository: the extension's files only, with forward-slash
# paths (Windows PowerShell 5.1's ZipFile.CreateFromDirectory writes backslashes, which the Chrome Web Store refuses).
# The store refuses the manifest's "key" (it only fixes the id of unpacked copies), so the zip's manifest has none.
# -Key <private .pem>: only for the store's first upload of a new item, which takes the id from a key.pem at the root.
param([string]$Key)
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content "$root\manifest.json" -Raw | ConvertFrom-Json).version
$zip = Join-Path (Split-Path -Parent $root) "JetseoNewsExtension-$version.zip"
$files = @("api.js", "background.js", "panel.html", "panel.css", "panel.js") + (Get-ChildItem "$root\icons" -File -Filter *.png | ForEach-Object { "icons/" + $_.Name }) + (Get-ChildItem "$root\fonts" -File | ForEach-Object { "fonts/" + $_.Name })
$manifest = [IO.File]::ReadAllText("$root\manifest.json") -replace '(?m)^\s*"key":\s*"[^"]*",\r?\n', ''
if ($manifest -match '"key":') { throw "manifest.json: the key line was not removed" }
if (Test-Path $zip) { Remove-Item $zip }
$stream = [IO.File]::Open($zip, 'Create')
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
$writer = New-Object IO.StreamWriter($archive.CreateEntry("manifest.json").Open(), (New-Object Text.UTF8Encoding($false)))
$writer.Write($manifest); $writer.Dispose()
foreach ($f in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $root $f), $f, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
if ($Key) { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Resolve-Path $Key), "key.pem") | Out-Null }
$archive.Dispose(); $stream.Dispose()
"$zip ($($files.Count + 1 + [int][bool]$Key) files$(if ($Key) { ', with key.pem: first upload only' }))"
