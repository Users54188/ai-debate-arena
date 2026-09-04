# regenerate-tabbar-icons.ps1
# Regenerate 4 tabBar icons to fix:
#   1. home.png / practice.png old bitmaps with white opaque background
#      showing as white box on dark tabBar (#0E0830)
#   2. home_sel.png / practice_sel.png missing (no selected state visual diff)
#
# Style matches W7 fix (commit 71fe338):
#   - 81x81 transparent PNG (PixelFormat.Format32bppArgb)
#   - solid color fill + anti-aliasing
#   - unselected: gray #999999
#   - selected: indigo #4F46E5
#
# Usage: powershell -ExecutionPolicy Bypass -File tools\regenerate-tabbar-icons.ps1

Add-Type -AssemblyName System.Drawing

$size = 81
$gray = [System.Drawing.Color]::FromArgb(153, 153, 153)
$indigo = [System.Drawing.Color]::FromArgb(79, 70, 229)

$dir = Resolve-Path "$PSScriptRoot\..\miniprogram\images"

function New-Icon {
    param(
        [string]$path,
        [System.Drawing.Color]$color,
        [string]$shape
    )

    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $brush = New-Object System.Drawing.SolidBrush $color

    if ($shape -eq 'home') {
        # House silhouette: triangle roof + rectangular body, no door
        $roof = [System.Drawing.Point[]]@(
            (New-Object System.Drawing.Point 40, 14),
            (New-Object System.Drawing.Point 14, 38),
            (New-Object System.Drawing.Point 67, 38)
        )
        $g.FillPolygon($brush, $roof)
        $body = New-Object System.Drawing.Rectangle 22, 38, 37, 30
        $g.FillRectangle($brush, $body)
    }
    elseif ($shape -eq 'practice') {
        # Lightbulb silhouette: circle head + neck + base rectangle + 2 cutout lines for base rings
        $head = New-Object System.Drawing.Rectangle 22, 10, 37, 37
        $g.FillEllipse($brush, $head)
        $neck = New-Object System.Drawing.Rectangle 32, 46, 17, 8
        $g.FillRectangle($brush, $neck)
        $base = New-Object System.Drawing.Rectangle 30, 52, 21, 16
        $g.FillRectangle($brush, $base)
        # Carve out 2 horizontal lines inside base (ring texture)
        $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $transparent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Transparent)
        $g.FillRectangle($transparent, 32, 56, 17, 2)
        $g.FillRectangle($transparent, 32, 61, 17, 2)
        $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    }

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()

    $bytes = (Get-Item $path).Length
    Write-Host ("  {0,-40} {1,6} bytes" -f (Split-Path $path -Leaf), $bytes)
}

Write-Host "Generating tabBar icons to: $dir"
New-Icon -path "$dir\home.png"         -color $gray   -shape 'home'
New-Icon -path "$dir\home_sel.png"     -color $indigo -shape 'home'
New-Icon -path "$dir\practice.png"     -color $gray   -shape 'practice'
New-Icon -path "$dir\practice_sel.png" -color $indigo -shape 'practice'
Write-Host "Done. Verify each file is < 40KB (WeChat tabBar limit)."
