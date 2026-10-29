# Builds JetseoNewsExtension-<version>.zip next to the repository: the extension's files only, with forward-slash
# paths (Windows PowerShell 5.1's ZipFile.CreateFromDirectory writes backslashes, which the Chrome Web Store refuses).
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content "$root\manifest.json" -Raw | ConvertFrom-Json).version
$zip = Join-Path (Split-Path -Parent $root) "JetseoNewsExtension-$version.zip"
$files = @("manifest.json", "api.js", "background.js", "panel.html", "panel.css", "panel.js") + (Get-ChildItem "$root\icons" -File | ForEach-Object { "icons/" + $_.Name })
if (Test-Path $zip) { Remove-Item $zip }
$stream = [IO.File]::Open($zip, 'Create')
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
foreach ($f in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $root $f), $f, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
}
$archive.Dispose(); $stream.Dispose()
"$zip ($($files.Count) files)"
