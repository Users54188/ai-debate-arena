Add-Type -AssemblyName System.Drawing
$path = "C:\Users\lee\Documents\Default Project\ai-debate-arena\work\header-logo-cutout.png"
$img = [System.Drawing.Bitmap]::FromFile($path)
$w = $img.Width; $h = $img.Height
Write-Output "size: ${w}x${h}"

# alpha distribution
$transparent = 0; $semi = 0; $opaque = 0
for ($y=0; $y -lt $h; $y+=3) {
  for ($x=0; $x -lt $w; $x+=3) {
    $p = $img.GetPixel($x,$y)
    if ($p.A -eq 0) { $transparent++ }
    elseif ($p.A -lt 255) { $semi++ }
    else { $opaque++ }
  }
}
Write-Output ("alpha sample (step3): transparent={0} semi={1} opaque={2}" -f $transparent,$semi,$opaque)

# corners
$pts = New-Object System.Collections.ArrayList
[void]$pts.Add(@(0,0))
[void]$pts.Add(@($w-1,0))
[void]$pts.Add(@(0,$h-1))
[void]$pts.Add(@($w-1,$h-1))
foreach($pt in $pts) {
  $x = [int]$pt[0]; $y = [int]$pt[1]
  $p = $img.GetPixel($x,$y)
  Write-Output "($x,$y): R=$($p.R) G=$($p.G) B=$($p.B) A=$($p.A)"
}
$img.Dispose()
