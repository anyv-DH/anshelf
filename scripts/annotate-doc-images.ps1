# Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE.
Add-Type -AssemblyName System.Drawing

$root = (Get-Location).Path
$images = Join-Path $root 'docs/images'
$fontName = 'Microsoft YaHei UI'

function Add-Callout {
  param(
    [System.Drawing.Graphics]$g,
    [int]$number,
    [string]$label,
    [int]$targetX,
    [int]$targetY,
    [int]$boxX,
    [int]$boxY,
    [int]$boxW = 235
  )
  $boxH = 42
  $accent = [System.Drawing.Color]::FromArgb(255, 255, 177, 218)
  $bubble = [System.Drawing.Color]::FromArgb(255, 174, 139, 255)
  $panel = [System.Drawing.Color]::FromArgb(235, 48, 37, 67)
  $white = [System.Drawing.Brushes]::White
  $line = New-Object System.Drawing.Pen($accent, 3)
  $g.DrawLine($line, $targetX, $targetY, $boxX + 18, $boxY + 21)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($bubble)), $targetX - 15, $targetY - 15, 30, 30)
  $g.DrawString([string]$number, (New-Object System.Drawing.Font($fontName, 12, [System.Drawing.FontStyle]::Bold)), $white, $targetX - 7, $targetY - 10)
  $radius = 12
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($boxX, $boxY, $radius * 2, $radius * 2, 180, 90)
  $path.AddArc($boxX + $boxW - $radius * 2, $boxY, $radius * 2, $radius * 2, 270, 90)
  $path.AddArc($boxX + $boxW - $radius * 2, $boxY + $boxH - $radius * 2, $radius * 2, $radius * 2, 0, 90)
  $path.AddArc($boxX, $boxY + $boxH - $radius * 2, $radius * 2, $radius * 2, 90, 90)
  $path.CloseFigure()
  $g.FillPath((New-Object System.Drawing.SolidBrush($panel)), $path)
  $g.DrawPath($line, $path)
  $g.DrawString($label, (New-Object System.Drawing.Font($fontName, 14, [System.Drawing.FontStyle]::Bold)), $white, $boxX + 12, $boxY + 10)
  $g.DrawString('✦', (New-Object System.Drawing.Font($fontName, 10, [System.Drawing.FontStyle]::Bold)), (New-Object System.Drawing.SolidBrush($accent)), $boxX + $boxW - 25, $boxY + 7)
  $path.Dispose(); $line.Dispose()
}

function Annotate {
  param([string]$source, [string]$destination, [scriptblock]$draw)
  $inputPath = Join-Path $images $source
  $outputPath = Join-Path $images $destination
  $bmp = [System.Drawing.Bitmap]::new($inputPath)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  & $draw $g $bmp.Width $bmp.Height
  $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Annotate 'library-overview.png' 'annotated-overview.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '搜索素材' 500 166 330 86 190
  Add-Callout $g 2 '点击预览图放大' 1030 260 780 86 245
  Add-Callout $g 3 '用 AN 打开' 285 406 220 485 205
  Add-Callout $g 4 '粘贴到舞台' 370 406 430 485 220
}

Annotate 'import-dialog-2k.png' 'annotated-import.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '复用同名预览图' 460 230 40 105 220
  Add-Callout $g 2 '选择目标分类' 650 345 850 285 220
  Add-Callout $g 3 '新建文件夹 / 子文件夹' 590 390 820 420 285
  Add-Callout $g 4 '选择 2K 预览' 755 475 55 510 210
  Add-Callout $g 5 '选择 FLA 或素材文件夹' 550 605 790 620 300
}

Annotate 'preview-lightbox.png' 'annotated-preview.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '滚轮放大 / 缩小' 980 648 50 590 225
  Add-Callout $g 2 '打开文件位置' 770 698 535 590 220
  Add-Callout $g 3 '用 AN 打开' 890 698 770 735 180
  Add-Callout $g 4 '粘贴到舞台' 1010 698 925 590 220
}

Annotate 'effects-preview-zoom.png' 'annotated-effects.png' {
  param($g,$w,$h)
  Add-Callout $g 1 'GIF 动图预览' 520 350 55 105 205
  Add-Callout $g 2 '滚轮查看细节' 980 648 780 590 230
}

Annotate 'audio-library.png' 'annotated-audio.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '试听 / 暂停' 315 475 45 530 190
  Add-Callout $g 2 '拖动进度' 590 755 390 650 200
  Add-Callout $g 3 '拖出音频副本' 560 475 700 530 250
}

Annotate 'category-navigation.png' 'annotated-category.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '当前顶层：特效' 520 120 40 86 220
  Add-Callout $g 2 '进入下一层子分类' 650 120 455 160 250
  Add-Callout $g 3 '最右侧 +：新建子分类' 1210 120 900 165 265
}

Annotate 'favorites-categories.png' 'annotated-favorites.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '收藏总览' 475 165 700 110 190
  Add-Callout $g 2 '按原路径分类' 600 165 780 180 220
  Add-Callout $g 3 '长期收藏素材' 500 520 700 510 220
}

Annotate 'subcategory-filter.png' 'annotated-filter.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '打开筛选菜单' 1325 220 1020 130 220
  Add-Callout $g 2 '隐藏已归入子文件夹' 370 120 500 170 300
  Add-Callout $g 3 '只看当前层素材' 480 320 520 420 230
}

Annotate 'compact-grid.png' 'annotated-compact.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '紧凑小窗' 840 60 35 95 180
  Add-Callout $g 2 '每行 4 / 5 / 6 个' 645 168 400 95 260
  Add-Callout $g 3 '卡片操作按钮' 300 412 30 520 230
}

Annotate 'compact-grid.png' 'annotated-send-an.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '用 AN 打开副本' 250 412 20 500 230
  Add-Callout $g 2 '粘贴到当前舞台' 335 412 430 500 250
  Add-Callout $g 3 '拖出素材到 AN' 310 300 430 280 220
}

Annotate 'warm-theme.png' 'annotated-warm.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '暗色 / 暖色切换' 110 700 30 610 245
  Add-Callout $g 2 '暖色主题' 720 80 475 120 190
  Add-Callout $g 3 '分类与搜索仍保留' 610 220 680 270 245
}

Annotate 'density-six-columns.png' 'annotated-density.png' {
  param($g,$w,$h)
  Add-Callout $g 1 '显示密度菜单' 990 168 730 90 220
  Add-Callout $g 2 '一行 6 个素材' 1000 168 1000 245 220
  Add-Callout $g 3 '更多预览同时可见' 740 340 820 390 245
}

$panelSource = [System.Drawing.Bitmap]::new((Join-Path $images 'animate-panel-compact.png'))
$panel = [System.Drawing.Bitmap]::new(960, 240)
$panelGraphics = [System.Drawing.Graphics]::FromImage($panel)
$panelGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$panelGraphics.DrawImage($panelSource, 0, 0, 960, 240)
Add-Callout $panelGraphics 1 '在 AN 中点击这里' 520 120 35 25 270
$panel.Save((Join-Path $images 'annotated-panel.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$panelGraphics.Dispose(); $panel.Dispose(); $panelSource.Dispose()

