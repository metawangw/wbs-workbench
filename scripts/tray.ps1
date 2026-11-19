# WBS 工作台 - 系统托盘（通知区域）图标
#
# 由 background_start.bat 通过 tray.vbs 以隐藏窗口方式启动，仅使用 Windows
# 自带的 PowerShell 5.1 + WinForms，不依赖任何第三方组件，也不需要 npm。
#
# 托盘图标的「退出服务」等价于运行 background_stop.bat：
#   用包内 Node 执行 scripts/launch.mjs --stop，停止后台服务后自己退出。
#
# 服务在别处被停止（例如双击 background_stop.bat）时，托盘会检测到
# .wbs-runtime.json 清空并自动退出，不会留下无意义的图标。

param(
  # 仅用于自检：图标出现 4 秒后自动执行一次「退出服务」，便于无人值守验证。
  [switch]$SelfTest,
  # 仅用于自检：把生成的托盘图标保存为 PNG 后立即退出，不创建通知区域图标。
  [string]$RenderPreview
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $root 'wbs-tray.log'
$pidFile = Join-Path $root '.wbs-tray.pid'
$runtimeFile = Join-Path $root '.wbs-runtime.json'
$launcher = Join-Path $root 'scripts\launch.mjs'

function Write-TrayLog {
  param([string]$Message)
  try {
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  } catch {
    # 日志失败不影响托盘本身
  }
}

trap {
  Write-TrayLog ("未处理异常：" + $_.Exception.Message)
  exit 1
}

# ---------- 单实例：重复点击 background_start 不会再叠加一个图标 ----------
$createdNew = $false
$mutex = $null
if (-not $RenderPreview) {
  try {
    $mutex = [System.Threading.Mutex]::new($true, 'Local\WBSWorkbenchTray', [ref]$createdNew)
  } catch {
    $createdNew = $true
  }
  if (-not $createdNew) {
    Write-TrayLog '托盘已在运行，忽略本次启动。'
    exit 0
  }
  # 保持引用，避免 Mutex 被 GC 回收后提前释放。
  $script:keepAlive = @($mutex)
}

# ---------- 包内 Node（按系统位数选择），用于执行 --stop ----------
$script:nodeExe = $null
$forced = $env:WBS_NODE_ARCH
$arch = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
if ($forced -eq 'x86' -or $forced -eq 'x64') { $arch = $forced }
$candidate = Join-Path $root ("runtime\{0}\node.exe" -f $arch)
$legacy = Join-Path $root 'runtime\node\node.exe'
$script:nodeExe = $null
foreach ($file in @($candidate, $legacy)) {
  if (Test-Path -LiteralPath $file) { $script:nodeExe = $file; break }
}
if (-not $script:nodeExe) {
  # 包内运行时缺失时退回系统 Node；正常解压的迁移包不会走到这里。
  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($systemNode) { $script:nodeExe = $systemNode.Source }
}

# ---------- 从 .wbs-config.json 读取品牌图标（文字 / 颜色 / 圆角） ----------
$glyph = 'W'
$accent = '#2563eb'
$radius = 7
$title = 'WBS 工作台'
$configPath = Join-Path $root '.wbs-config.json'
if (Test-Path -LiteralPath $configPath) {
  try {
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $brand = $config.settings.brand
    if ($brand) {
      if ($brand.title) { $title = [string]$brand.title }
      if ($brand.icon) {
        $clean = ([string]$brand.icon) -replace '[<>&"'']', ''
        $clean = $clean.Trim()
        if ($clean.Length -gt 0) { $glyph = $clean }
      }
      if ($brand.iconColor -match '^#[0-9a-fA-F]{6}$') { $accent = [string]$brand.iconColor }
      if ($null -ne $brand.iconRadius) { $radius = [int]$brand.iconRadius }
    }
  } catch {
    Write-TrayLog ("读取品牌配置失败，使用默认样式：" + $_.Exception.Message)
  }
}

# 托盘尺寸很小，多字图标只取首字，保证清晰可辨。
$trayGlyph = $glyph.Substring(0, [Math]::Min(1, $glyph.Length))

$script:fontFamily = 'Segoe UI'
try {
  $fonts = (New-Object System.Drawing.Text.InstalledFontCollection).Families |
    ForEach-Object { $_.Name }
  foreach ($name in @('Microsoft YaHei', 'Microsoft YaHei UI', 'SimHei', 'Segoe UI')) {
    if ($fonts -contains $name) { $script:fontFamily = $name; break }
  }
} catch {
  # 字体枚举失败时保留默认字体
}

function New-TrayIcon {
  param([string]$Text, [string]$Color, [int]$Corner)

  $canvas = 64
  $big = [System.Drawing.Bitmap]::new($canvas, $canvas)
  $graphics = [System.Drawing.Graphics]::FromImage($big)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = [single]($Corner * $canvas / 64)
    if ($r -lt 0.5) { $r = [single]0 }
    $d = [single]($r * 2)
    if ($d -gt 0) {
      $path.AddArc([single]0, [single]0, $d, $d, [single]180, [single]90)
      $path.AddArc([single]($canvas - $d), [single]0, $d, $d, [single]270, [single]90)
      $path.AddArc([single]($canvas - $d), [single]($canvas - $d), $d, $d, [single]0, [single]90)
      $path.AddArc([single]0, [single]($canvas - $d), $d, $d, [single]90, [single]90)
      $path.CloseFigure()
    } else {
      $path.AddRectangle([System.Drawing.RectangleF]::new(0, 0, $canvas, $canvas))
    }

    $fill = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($Color))
    $graphics.FillPath($fill, $path)
    $fill.Dispose()
    $path.Dispose()

    $size = if ($Text.Length -gt 1) { [single]26 } else { [single]42 }
    $font = [System.Drawing.Font]::new(
      $script:fontFamily,
      $size,
      [System.Drawing.FontStyle]::Bold,
      [System.Drawing.GraphicsUnit]::Pixel
    )
    $format = [System.Drawing.StringFormat]::new()
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = [System.Drawing.RectangleF]::new(0, 0, $canvas, $canvas)
    $graphics.DrawString($Text, $font, [System.Drawing.Brushes]::White, $rect, $format)
    $font.Dispose()
    $format.Dispose()
  } finally {
    $graphics.Dispose()
  }

  # 缩到 32px，让高 DPI 下的托盘图标边缘更平滑。
  $small = [System.Drawing.Bitmap]::new(32, 32)
  $scale = [System.Drawing.Graphics]::FromImage($small)
  try {
    $scale.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scale.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $scale.DrawImage($big, 0, 0, 32, 32)
  } finally {
    $scale.Dispose()
    $big.Dispose()
  }

  $icon = [System.Drawing.Icon]::FromHandle($small.GetHicon())
  # HICON 由位图句柄提供，必须保持位图存活。
  $script:trayBitmap = $small
  return $icon
}

# ---------- 服务状态：读取 .wbs-runtime.json 并做端口存活探测 ----------
function Test-ServicePort {
  param([int]$Port)
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if ($task.Wait(400) -and $client.Connected) { return $true }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Get-ServiceState {
  if (-not (Test-Path -LiteralPath $runtimeFile)) { return $null }
  try {
    $raw = Get-Content -LiteralPath $runtimeFile -Raw -Encoding UTF8
    if (-not $raw -or $raw.Trim() -eq '') { return $null }
    $obj = $raw | ConvertFrom-Json
    if (-not $obj) { return $null }
    $props = @($obj.PSObject.Properties)
    if ($props.Count -eq 0) { return $null }
    foreach ($prop in $props) {
      $port = 0
      if (-not [int]::TryParse($prop.Name, [ref]$port)) { continue }
      if (-not (Test-ServicePort $port)) { continue }
      $url = $prop.Value.url
      if (-not $url) { $url = "http://127.0.0.1:$port" }
      return [pscustomobject]@{ Port = $port; Url = [string]$url; Pid = $prop.Value.pid }
    }
    return $null
  } catch {
    return $null
  }
}

$script:closing = $false
$script:url = $null
$script:observed = $false
$script:startedAt = Get-Date

function Close-Tray {
  param([string]$Reason)
  if ($script:closing) { return }
  $script:closing = $true
  Write-TrayLog ("托盘退出：" + $Reason)
  try { $script:timer.Stop() } catch { }
  try {
    $script:notify.Visible = $false
    $script:notify.Dispose()
  } catch { }
  try {
    if (Test-Path -LiteralPath $pidFile) {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    }
  } catch { }
  try { $script:context.ExitThread() } catch { }
}

# ---------- 菜单动作 ----------
$openAction = {
  $target = $script:url
  if (-not $target) {
    $state = Get-ServiceState
    if ($state) { $target = $state.Url; $script:url = $target }
  }
  if (-not $target) {
    $script:notify.ShowBalloonTip(3000, $title, '服务未运行，请先运行 background_start.bat。', 'Warning')
    return
  }
  try {
    Start-Process $target
  } catch {
    Write-TrayLog ("打开浏览器失败：" + $_.Exception.Message)
  }
}

$copyAction = {
  $target = $script:url
  if (-not $target) { $target = 'http://127.0.0.1:5178' }
  try {
    [System.Windows.Forms.Clipboard]::SetText($target)
    $script:notify.ShowBalloonTip(1500, $title, "已复制：$target", 'Info')
  } catch {
    Write-TrayLog ("复制访问地址失败：" + $_.Exception.Message)
  }
}

$stopAction = {
  if ($script:closing) { return }
  Write-TrayLog '开始停止后台服务（等同 background_stop.bat）。'
  try { $script:notify.Text = 'WBS 工作台 · 正在停止…' } catch { }
  if (-not $script:nodeExe) {
    Write-TrayLog '未找到可用的 Node 运行时，无法执行停止命令，仅关闭托盘。'
    Close-Tray '缺少运行时，仅关闭托盘'
    return
  }
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:nodeExe
    $psi.Arguments = '"{0}" --stop' -f $launcher
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $proc = [System.Diagnostics.Process]::Start($psi)
    if (-not $proc.WaitForExit(20000)) {
      Write-TrayLog '停止命令超时，继续退出托盘。'
    } else {
      Write-TrayLog ("停止命令结束，退出码 {0}。" -f $proc.ExitCode)
    }
  } catch {
    Write-TrayLog ("执行停止命令失败：" + $_.Exception.Message)
  }
  Close-Tray '用户点击退出服务'
}

# ---------- 托盘图标与菜单 ----------
$script:icon = New-TrayIcon -Text $trayGlyph -Color $accent -Corner $radius

if ($RenderPreview) {
  $target = $RenderPreview
  if (-not [System.IO.Path]::IsPathRooted($target)) { $target = Join-Path $root $target }
  $script:trayBitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-TrayLog ('已导出托盘图标预览：' + $target)
  exit 0
}

$script:notify = [System.Windows.Forms.NotifyIcon]::new()
$script:notify.Icon = $script:icon
$script:notify.Text = "$title · 运行中"
$script:notify.Visible = $true

$menu = [System.Windows.Forms.ContextMenuStrip]::new()
$itemOpen = $menu.Items.Add('打开工作台')
$itemOpen.add_Click($openAction)
$itemCopy = $menu.Items.Add('复制访问地址')
$itemCopy.add_Click($copyAction)
$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new()) | Out-Null
$itemStop = $menu.Items.Add('退出服务')
$itemStop.add_Click($stopAction)
$script:notify.ContextMenuStrip = $menu
$script:notify.add_MouseDoubleClick($openAction)

Set-Content -LiteralPath $pidFile -Value $PID -Encoding ASCII

# 每 4 秒确认服务仍在运行；服务消失则自动收起图标。
$script:timer = [System.Windows.Forms.Timer]::new()
$script:timer.Interval = 4000
$script:timer.add_Tick({
  $state = Get-ServiceState
  if ($state) {
    $script:url = $state.Url
    $script:observed = $true
    try { $script:notify.Text = "$title · 运行中 ($($state.Port))" } catch { }
    return
  }
  if (-not $script:observed) {
    # 启动阶段服务可能还在构建前端，给 120 秒宽限期。
    if (((Get-Date) - $script:startedAt).TotalSeconds -lt 120) { return }
    Close-Tray '等待服务启动超时'
    return
  }
  Close-Tray '服务已停止'
})
$script:timer.Start()

$script:context = [System.Windows.Forms.ApplicationContext]::new()

if ($SelfTest) {
  $script:testTimer = [System.Windows.Forms.Timer]::new()
  $script:testTimer.Interval = 4000
  $script:testTimer.add_Tick({
    $script:testTimer.Stop()
    Write-TrayLog ('自检：图标已显示，提示文字=' + $script:notify.Text)
    & $stopAction
  })
  $script:testTimer.Start()
}

Write-TrayLog ("托盘已启动：PID $PID，图标=$trayGlyph，颜色=$accent，运行时=$($script:nodeExe)")

[System.Windows.Forms.Application]::Run($script:context)

Write-TrayLog '托盘进程结束。'
