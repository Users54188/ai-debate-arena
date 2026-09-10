Add-Type -AssemblyName System.Drawing
$path = "C:\Users\lee\Documents\Default Project\ai-debate-arena\miniprogram\images\header-logo.png"
$img = [System.Drawing.Bitmap]::FromFile($path)
$w = $img.Width; $h = $img.Height
Write-Output "size: ${w}x${h}"

$pts = New-Object System.Collections.ArrayList
[void]$pts.Add(@(0,0))
[void]$pts.Add(@($w-1,0))
[void]$pts.Add(@(0,$h-1))
[void]$pts.Add(@($w-1,$h-1))
[void]$pts.Add(@([int]($w*0.02),[int]($h*0.02)))
[void]$pts.Add(@([int]($w/2),[int]($h/2)))
[void]$pts.Add(@([int]($w/2),[int]($h*0.15)))
foreach($pt in $pts) {
  $x = [int]$pt[0]; $y = [int]$pt[1]
  $p = $img.GetPixel($x,$y)
  Write-Output "($x,$y): R=$($p.R) G=$($p.G) B=$($p.B) A=$($p.A)"
}

$nearWhite = 0; $total = 0
for ($y=0; $y -lt $h; $y++) {
  for ($x=0; $x -lt $w; $x++) {
    $p = $img.GetPixel($x,$y)
    if ($p.R -gt 245 -and $p.G -gt 245 -and $p.B -gt 245) { $nearWhite++ }
    $total++
  }
}
Write-Output ("near-white(>245) pixels: {0}/{1} = {2:P1}" -f $nearWhite,$total,($nearWhite/$total))
$img.Dispose()
