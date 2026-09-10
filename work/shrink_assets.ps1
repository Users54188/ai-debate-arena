Add-Type -AssemblyName System.Drawing

$imgDir = "C:\Users\lee\Documents\Default Project\ai-debate-arena\miniprogram\images"

function Resize-Png($src, $longEdge) {
    $orig = [System.Drawing.Bitmap]::FromFile($src)
    $ow = $orig.Width; $oh = $orig.Height
    $scale = $longEdge / [math]::Max($ow, $oh)
    $nw = [int][math]::Round($ow * $scale)
    $nh = [int][math]::Round($oh * $scale)

    $bmp = New-Object System.Drawing.Bitmap($nw, $nh, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($orig, 0, 0, $nw, $nh)
    $g.Dispose(); $orig.Dispose()
    $bmp.Save($src, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $kb = (Get-Item $src).Length / 1KB
    Write-Output ("{0}: {1}x{2}, {3:N0} KB" -f (Split-Path $src -Leaf), $nw, $nh, $kb)
}

# logo 宽 420
Resize-Png (Join-Path $imgDir "header-logo.png") 420
# 徽章长边 240
Resize-Png (Join-Path $imgDir "rank-bronze.png") 240
Resize-Png (Join-Path $imgDir "rank-silver.png") 240
Resize-Png (Join-Path $imgDir "rank-gold.png") 240
