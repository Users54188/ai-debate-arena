Add-Type -AssemblyName System.Drawing
$src = "C:\Users\lee\Documents\Default Project\ai-debate-arena\work\header-logo-cutout.png"
$dst = "C:\Users\lee\Documents\Default Project\ai-debate-arena\miniprogram\images\header-logo.png"

$orig = [System.Drawing.Bitmap]::FromFile($src)
$ow = $orig.Width; $oh = $orig.Height
$nw = 720
$nh = [int][math]::Round($oh * $nw / $ow)
Write-Output "resize ${ow}x${oh} -> ${nw}x${nh}"

$bmp = New-Object System.Drawing.Bitmap($nw, $nh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($orig, 0, 0, $nw, $nh)
$g.Dispose()
$orig.Dispose()

$bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$f = Get-Item $dst
Write-Output ("saved header-logo.png: {0:N0} KB ({1}x{2})" -f ($f.Length/1KB), $nw, $nh)
