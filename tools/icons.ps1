# The news extension's icons from icons\icon.svg: the JetSEO extension's mark (navy square, white and orange rocket,
# brand\jetseo-mark.svg of the Persian extension) with the rocket moved up-left and RSS waves in the freed corner.
# Edge renders the SVG once at 512px (headless, transparent background); each size is scaled down from that.
# Usage: powershell -File tools\icons.ps1
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$icons = Resolve-Path "$PSScriptRoot\..\icons"
# a work folder of our own: Edge did not write its screenshot under the user's temp path (8.3 short name)
$tmp = Join-Path (Resolve-Path "$PSScriptRoot\..") ".icons-tmp"
New-Item -ItemType Directory -Force $tmp | Out-Null
$big = Join-Path $tmp "icon-512.png"
Remove-Item $big -ErrorAction SilentlyContinue
$svg = "file:///" + ("$icons\icon.svg" -replace "\\", "/")
Start-Process $edge -Wait -ArgumentList "--headless=new", "--disable-gpu", "--hide-scrollbars", "--user-data-dir=$tmp\profile",
  "--default-background-color=00000000", "--window-size=512,512", "--screenshot=$big", $svg
if (-not (Test-Path $big)) { throw "Edge did not render $svg" }

Add-Type -AssemblyName System.Drawing
$src = [Drawing.Image]::FromFile($big)
foreach ($s in 16, 32, 48, 128) {
  $out = New-Object Drawing.Bitmap $s, $s
  $g = [Drawing.Graphics]::FromImage($out)
  $g.InterpolationMode = "HighQualityBicubic"; $g.PixelOffsetMode = "HighQuality"; $g.SmoothingMode = "AntiAlias"
  $g.DrawImage($src, 0, 0, $s, $s)
  $g.Dispose()
  $out.Save("$icons\icon-$s.png", [Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
}
$src.Dispose()
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
