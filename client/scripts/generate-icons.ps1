$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# ============================================================================
# KNUST Bus Tracker — PWA icon generator (Windows PowerShell / System.Drawing)
# Renders the favicon design (dark rounded square + gold bus) as PNG files at
# the sizes required by a web app manifest (192, 512, maskable 512) and the
# Apple touch icon (180). No external dependencies.
#
#   powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
# Output: client/public/icons/*.png
# ============================================================================

$outDir = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Palette (matches tailwind theme + favicon)
$bg   = [System.Drawing.Color]::FromArgb(255,  15,  23,  42)  # night #0f172a
$gold = [System.Drawing.Color]::FromArgb(255, 201, 162,  39)  # brand #C9A227
$dark = [System.Drawing.Color]::FromArgb(255,  17,  24,  39)  # #111827

# Map / rounded-rect helpers (grid is a 0..64 canvas, like the favicon)
function Px { param([float]$Grid, [float]$u, [float]$scale, [float]$cx) (($Grid - 32) * $u * $scale) + $cx }
function Sx { param([float]$Grid, [float]$u, [float]$scale) $Grid * $u * $scale }

function New-RoundedRectPath {
  param([float]$x, [float]$y, [float]$w, [float]$h, [float]$r)
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y,           $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Draw the bus at the centre of `size`, scaled by `$scale` (1 = favicon layout,
# ~0.72 = maskable-safe so the glyph stays inside the 80% safe zone).
function New-BusIcon {
  param([int]$Size, [float]$Scale)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear($bg)

  $u   = $Size / 64.0
  $cx  = $Size / 2.0
  $goldBrush = New-Object System.Drawing.SolidBrush($gold)
  $darkBrush = New-Object System.Drawing.SolidBrush($dark)
  $glassBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 15, 23, 42))

  # bus body (grid: x18..46, y20..44, r4)
  $body = New-RoundedRectPath (
    (Px 18 $u $Scale $cx)) ((Px 20 $u $Scale $cx)) (Sx 28 $u $Scale) (Sx 24 $u $Scale) (Sx 4 $u $Scale)
  $g.FillPath($goldBrush, $body)

  # roof strip / front glass (grid: x20, y22, w24, h5, r1.5)
  $glass = New-RoundedRectPath (
    (Px 20 $u $Scale $cx)) ((Px 22 $u $Scale $cx)) (Sx 24 $u $Scale) (Sx 5 $u $Scale) (Sx 1.5 $u $Scale)
  $g.FillPath($glassBrush, $glass)

  # windows band (grid: x20, y30, w24, h5, r1.5)
  $win = New-RoundedRectPath (
    (Px 20 $u $Scale $cx)) ((Px 30 $u $Scale $cx)) (Sx 24 $u $Scale) (Sx 5 $u $Scale) (Sx 1.5 $u $Scale)
  $g.FillPath($darkBrush, $win)

  # wheels (grid centres 24/40, y40, r3.2)
  $g.FillEllipse($darkBrush, (Px (24 - 3.2) $u $Scale $cx), (Px (40 - 3.2) $u $Scale $cx), (Sx 6.4 $u $Scale), (Sx 6.4 $u $Scale))
  $g.FillEllipse($darkBrush, (Px (40 - 3.2) $u $Scale $cx), (Px (40 - 3.2) $u $Scale $cx), (Sx 6.4 $u $Scale), (Sx 6.4 $u $Scale))

  $g.Dispose()
  return $bmp
}

function Save-Png {
  param([int]$Size, [float]$Scale, [string]$Name)
  $icon = New-BusIcon -Size $Size -Scale $Scale
  $path = Join-Path $outDir $Name
  $icon.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $icon.Dispose()
  Write-Output ("generated {0} ({1}x{1})" -f $Name, $Size)
}

# Standard manifest icons
Save-Png -Size 192 -Scale 1.0 -Name 'icon-192.png'
Save-Png -Size 512 -Scale 1.0 -Name 'icon-512.png'
# Maskable variant: glyph scaled down so it survives circular/rounded masks
Save-Png -Size 512 -Scale 0.72 -Name 'maskable-512.png'
# Apple home-screen touch icon (no transparency, full-bleed background)
Save-Png -Size 180 -Scale 1.0 -Name 'apple-touch-icon.png'

Write-Output ("icons written to {0}" -f $outDir)
