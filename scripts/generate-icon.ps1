Add-Type -AssemblyName System.Drawing
$iconRoot = Join-Path $PSScriptRoot '../.local'
New-Item -ItemType Directory -Path $iconRoot -Force | Out-Null
$bitmap = [System.Drawing.Bitmap]::new(512, 512)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#15765f'))
$font = [System.Drawing.Font]::new('Segoe UI', 194, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$graphics.DrawString('Pi', $font, [System.Drawing.Brushes]::White, [System.Drawing.RectangleF]::new(0, -12, 512, 512), $format)
$bitmap.Save((Join-Path $iconRoot 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$format.Dispose()
$font.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
