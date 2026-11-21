<#
  GLEAM 本地预览服务
  - 双击 preview.cmd 启动：自动选择端口、打印电脑/手机预览地址、打开浏览器
  - 监听 0.0.0.0，同一 Wi-Fi 下的手机可以直接访问
  - 关闭窗口或按 Ctrl+C 即停止，不留后台进程
#>
[CmdletBinding()]
param(
  [int]$Port = 8765,
  [ValidateSet('auto', 'mobile', 'desktop')]
  [string]$Window = 'auto',
  [switch]$NoBrowser,
  [switch]$Check
)

$ErrorActionPreference = 'Stop'

$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$rootPrefix = $root.TrimEnd('\') + '\'

$mime = @{
  '.html'    = 'text/html; charset=utf-8'
  '.htm'     = 'text/html; charset=utf-8'
  '.css'     = 'text/css; charset=utf-8'
  '.js'      = 'text/javascript; charset=utf-8'
  '.mjs'     = 'text/javascript; charset=utf-8'
  '.json'    = 'application/json; charset=utf-8'
  '.geojson' = 'application/geo+json; charset=utf-8'
  '.svg'     = 'image/svg+xml'
  '.png'     = 'image/png'
  '.jpg'     = 'image/jpeg'
  '.jpeg'    = 'image/jpeg'
  '.webp'    = 'image/webp'
  '.gif'     = 'image/gif'
  '.ico'     = 'image/x-icon'
  '.woff2'   = 'font/woff2'
  '.woff'    = 'font/woff'
  '.ttf'     = 'font/ttf'
  '.txt'     = 'text/plain; charset=utf-8'
  '.md'      = 'text/plain; charset=utf-8'
  '.map'     = 'application/json; charset=utf-8'
}

function Get-FreePort {
  param([int]$StartPort, [int]$Count = 20)

  for ($i = 0; $i -lt $Count; $i++) {
    $candidate = $StartPort + $i
    try {
      $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $candidate)
      $probe.Start()
      $probe.Stop()
      return $candidate
    } catch {
      # 端口被占用，继续试下一个
    }
  }
  return 0
}

function Get-LanIp {
  $candidates = @()
  try {
    foreach ($nic in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($nic.OperationalStatus -ne 'Up') { continue }
      if ($nic.NetworkInterfaceType -eq 'Loopback') { continue }
      if ($nic.Name -match 'vEthernet|VMware|VirtualBox|Hyper-V|Bluetooth|WSL|Tailscale|ZeroTier') { continue }

      $score = 50
      if ($nic.Name -match 'WLAN|Wi-?Fi|无线') { $score = 100 }
      elseif ($nic.NetworkInterfaceType -eq 'Ethernet') { $score = 90 }

      foreach ($addr in $nic.GetIPProperties().UnicastAddresses) {
        if ($addr.Address.AddressFamily -ne 'InterNetwork') { continue }
        $ip = $addr.Address.ToString()
        if ($ip -match '^(127\.|169\.254\.|0\.)') { continue }
        $candidates += [pscustomobject]@{ IP = $ip; Score = $score }
      }
    }
  } catch {
    return $null
  }

  if ($candidates.Count -eq 0) { return $null }
  return ($candidates | Sort-Object -Property Score -Descending | Select-Object -First 1).IP
}

function Show-PreviewBanner {
  param([int]$LocalPort, [string]$LanIp)

  $line = '  ---------------------------------------------------'

  Write-Host ''
  Write-Host '  预览' -ForegroundColor Cyan
  Write-Host $line -ForegroundColor DarkGray
  Write-Host ('    电脑   http://127.0.0.1:{0}/' -f $LocalPort) -ForegroundColor Green
  if ($LanIp) {
    Write-Host ('    手机   http://{0}:{1}/' -f $LanIp, $LocalPort) -ForegroundColor Green
  } else {
    Write-Host '    手机   未检测到局域网地址，请改用电脑查看' -ForegroundColor Yellow
  }
  Write-Host '           手机要和这台电脑连同一个 Wi-Fi'
  Write-Host $line -ForegroundColor DarkGray
  Write-Host ''
}

function Open-Preview {
  param([string]$Url, [string]$Mode)

  $bases = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) | Where-Object { $_ }
  $relatives = @(
    'Microsoft\Edge\Application\msedge.exe',
    'Google\Chrome\Application\chrome.exe'
  )
  $browser = $null
  foreach ($base in $bases) {
    foreach ($relative in $relatives) {
      $candidate = Join-Path $base $relative
      if (Test-Path -LiteralPath $candidate) { $browser = $candidate; break }
    }
    if ($browser) { break }
  }

  if ($browser -and $Mode -ne 'auto') {
    if ($Mode -eq 'mobile') {
      $size = '--window-size=390,844'
    } else {
      $size = '--window-size=1440,900'
    }
    Start-Process -FilePath $browser -ArgumentList "--app=$Url", $size | Out-Null
    return
  }

  Start-Process $Url | Out-Null
}

function Send-Response {
  param($Stream, [string]$Status, [string]$ContentType, [byte[]]$Body, [bool]$HeadOnly)

  $head = "HTTP/1.1 $Status`r`n" +
          "Content-Type: $ContentType`r`n" +
          "Content-Length: $($Body.Length)`r`n" +
          "Cache-Control: no-store`r`n" +
          "Connection: close`r`n`r`n"
  $headBytes = [System.Text.Encoding]::ASCII.GetBytes($head)

  $Stream.Write($headBytes, 0, $headBytes.Length)
  if (-not $HeadOnly) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

function Invoke-Request {
  param($Client)

  $Client.ReceiveTimeout = 2000
  $Client.SendTimeout = 5000

  $stream = $Client.GetStream()
  $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)

  $requestLine = $reader.ReadLine()
  if ([string]::IsNullOrWhiteSpace($requestLine)) { return }

  while (($header = $reader.ReadLine()) -ne $null -and $header -ne '') {
    # 读完请求头即可，本服务不依赖任何请求头
  }

  $parts = $requestLine -split ' '
  if ($parts.Count -lt 2) {
    Send-Response -Stream $stream -Status '400 Bad Request' -ContentType 'text/plain; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes('Bad request')) -HeadOnly $false
    return
  }

  $method = $parts[0].ToUpperInvariant()
  $target = $parts[1]

  if ($method -ne 'GET' -and $method -ne 'HEAD') {
    Send-Response -Stream $stream -Status '405 Method Not Allowed' -ContentType 'text/plain; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes('Method not allowed')) -HeadOnly ($method -eq 'HEAD')
    return
  }

  $decoded = [System.Uri]::UnescapeDataString(($target -split '\?')[0])
  if ([string]::IsNullOrEmpty($decoded)) { $decoded = '/' }
  if ($decoded -eq '/') { $decoded = '/index.html' }

  $relative = $decoded.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
  $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

  $status = '404 Not Found'
  $contentType = 'text/plain; charset=utf-8'
  $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')

  if (-not $full.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    $status = '403 Forbidden'
    $body = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
  } elseif (Test-Path -LiteralPath $full -PathType Container) {
    $index = Join-Path $full 'index.html'
    if (Test-Path -LiteralPath $index -PathType Leaf) {
      $full = $index
    }
  }

  if ($status -eq '404 Not Found' -and (Test-Path -LiteralPath $full -PathType Leaf)) {
    $status = '200 OK'
    $body = [System.IO.File]::ReadAllBytes($full)
    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    if ($mime.ContainsKey($ext)) { $contentType = $mime[$ext] }
    else { $contentType = 'application/octet-stream' }
  }

  Send-Response -Stream $stream -Status $status -ContentType $contentType -Body $body -HeadOnly ($method -eq 'HEAD')
}

# ---------------------------------------------------------------- 入口

$indexPath = Join-Path $root 'index.html'
if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
  Write-Host ("找不到 index.html：{0}" -f $indexPath) -ForegroundColor Red
  exit 1
}

if ($Check) {
  $free = Get-FreePort -StartPort $Port
  $lan = Get-LanIp
  Write-Host ("项目根目录：{0}" -f $root)
  Write-Host ("可用端口：{0}" -f $(if ($free -gt 0) { $free } else { '无（8765-8784 均被占用）' }))
  Write-Host ("局域网地址：{0}" -f $(if ($lan) { $lan } else { '未检测到' }))
  exit 0
}

$port = Get-FreePort -StartPort $Port
if ($port -eq 0) {
  Write-Host ("端口 {0}-{1} 都被占用，请先关闭旧的预览窗口再试。" -f $Port, ($Port + 19)) -ForegroundColor Red
  exit 1
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
try {
  $listener.Start()
} catch {
  Write-Host ("启动服务失败：{0}" -f $_.Exception.Message) -ForegroundColor Red
  exit 1
}

$lan = Get-LanIp
Show-PreviewBanner -LocalPort $port -LanIp $lan

if (-not $NoBrowser) {
  try {
    Open-Preview -Url ('http://127.0.0.1:{0}/' -f $port) -Mode $Window
  } catch {
    Write-Host '没能自动打开浏览器，请手动点击上面的链接。' -ForegroundColor Yellow
  }
}

Write-Host '  关闭这个窗口（或按 Ctrl+C）即可停止预览。' -ForegroundColor DarkGray
Write-Host '  手机打不开：请在 Windows 防火墙弹窗里允许「专用网络」。' -ForegroundColor DarkGray
Write-Host ''

try {
  while ($true) {
    if (-not $listener.Pending()) {
      Start-Sleep -Milliseconds 25
      continue
    }
    $client = $listener.AcceptTcpClient()
    try {
      Invoke-Request -Client $client
    } catch {
      # 浏览器可能随时断开连接，保持服务继续运行
    } finally {
      if ($client) { $client.Close() }
    }
  }
} finally {
  $listener.Stop()
  Write-Host ''
  Write-Host '预览服务已停止。' -ForegroundColor DarkGray
}
