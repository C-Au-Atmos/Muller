param(
    [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\src-tauri\icons"),
    [string]$PublicDirectory = (Join-Path $PSScriptRoot "..\public")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class MullerNativeIcon {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern bool DestroyIcon(IntPtr handle);
}
"@

function New-RoundedPath {
    param(
        [float]$X,
        [float]$Y,
        [float]$Width,
        [float]$Height,
        [float]$Radius
    )

    $diameter = $Radius * 2
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
    $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
    $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-MullerBitmap {
    param([int]$Size)

    $bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $margin = [float]($Size * 0.065)
    $radius = [float]($Size * 0.17)
    $path = New-RoundedPath -X $margin -Y $margin -Width ($Size - $margin * 2) -Height ($Size - $margin * 2) -Radius $radius
    $background = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#10131A"))
    $outline = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml("#465268"), [float]($Size * 0.022))
    $graphics.FillPath($background, $path)
    $graphics.DrawPath($outline, $path)

    $font = [System.Drawing.Font]::new("Segoe UI", [float]($Size * 0.48), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#F5F5FA"))
    $textArea = [System.Drawing.RectangleF]::new(0, [float](-$Size * 0.035), $Size, $Size)
    $graphics.DrawString("M", $font, $textBrush, $textArea, $format)

    $barY = [float]($Size * 0.805)
    $barHeight = [float]($Size * 0.026)
    $barWidth = [float]($Size * 0.15)
    $barGap = [float]($Size * 0.022)
    $barStart = ($Size - ($barWidth * 3 + $barGap * 2)) / 2
    $colors = @("#7357CC", "#3B82F6", "#22C3D6")
    for ($index = 0; $index -lt $colors.Count; $index++) {
        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($colors[$index]))
        $graphics.FillRectangle($brush, [float]($barStart + $index * ($barWidth + $barGap)), $barY, $barWidth, $barHeight)
        $brush.Dispose()
    }

    $textBrush.Dispose()
    $format.Dispose()
    $font.Dispose()
    $outline.Dispose()
    $background.Dispose()
    $path.Dispose()
    $graphics.Dispose()
    return $bitmap
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $PublicDirectory | Out-Null

$bitmap = New-MullerBitmap -Size 512
$pngPath = Join-Path $OutputDirectory "icon.png"
$publicPath = Join-Path $PublicDirectory "muller-icon.png"
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Save($publicPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()

$iconBitmap = New-MullerBitmap -Size 256
$iconHandle = $iconBitmap.GetHicon()
try {
    $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
    $stream = [System.IO.File]::Create((Join-Path $OutputDirectory "icon.ico"))
    try {
        $icon.Save($stream)
    }
    finally {
        $stream.Dispose()
        $icon.Dispose()
    }
}
finally {
    [MullerNativeIcon]::DestroyIcon($iconHandle) | Out-Null
    $iconBitmap.Dispose()
}

Write-Output "Generated Muller icons in $OutputDirectory"

