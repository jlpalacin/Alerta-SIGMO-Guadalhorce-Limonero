$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = $null
$port = $null

foreach ($candidatePort in 8787..8799) {
  try {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, $candidatePort)
    $listener.Start()
    $port = $candidatePort
    break
  } catch {
    if ($listener) { $listener.Stop() }
    $listener = $null
  }
}

if (-not $listener) {
  throw "No se ha podido abrir ningun puerto entre 8787 y 8799."
}

$localIps = [Net.Dns]::GetHostAddresses([Net.Dns]::GetHostName()) |
  Where-Object { $_.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and -not $_.IPAddressToString.StartsWith("169.254.") } |
  Select-Object -ExpandProperty IPAddressToString

Write-Host "Servidor Alerta de Embalses en http://127.0.0.1:$port/"
foreach ($ip in $localIps) {
  Write-Host "URL para movil en la misma Wi-Fi: http://$ip`:$port/"
}
Start-Process "http://127.0.0.1:$port/"

function Send-Response($stream, [int]$status, [string]$contentType, [byte[]]$body) {
  $reason = if ($status -eq 200) { "OK" } elseif ($status -eq 204) { "No Content" } elseif ($status -eq 404) { "Not Found" } else { "Bad Gateway" }
  $headers = @(
    "HTTP/1.1 $status $reason",
    "Content-Type: $contentType",
    "Content-Length: $($body.Length)",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, OPTIONS",
    "Access-Control-Allow-Headers: Content-Type",
    "Connection: close",
    "",
    ""
  ) -join "`r`n"
  $headBytes = [Text.Encoding]::ASCII.GetBytes($headers)
  $stream.Write($headBytes, 0, $headBytes.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
}

function Get-ContentType([string]$path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "application/javascript; charset=utf-8" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".png" { "image/png" }
    ".svg" { "image/svg+xml" }
    ".webmanifest" { "application/manifest+json; charset=utf-8" }
    ".txt" { "text/plain; charset=utf-8" }
    default { "application/octet-stream" }
  }
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $stream.ReadTimeout = 3000
      $stream.WriteTimeout = 10000
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

      while ($reader.ReadLine()) {}

      $parts = $requestLine.Split(" ")
      $method = $parts[0]
      $rawPath = if ($parts.Count -gt 1) { $parts[1] } else { "/" }
      $pathOnly = $rawPath.Split("?")[0]
      $path = [Uri]::UnescapeDataString($pathOnly.TrimStart("/"))
      if ([string]::IsNullOrWhiteSpace($path)) { $path = "index.html" }

      if ($method -eq "OPTIONS") {
        Send-Response $stream 204 "text/plain; charset=utf-8" ([byte[]]::new(0))
      } elseif ($path -eq "ign-terremotos") {
        try {
          $response = Invoke-WebRequest -UseBasicParsing "https://www.ign.es/web/ign/portal/ultimos-terremotos" -TimeoutSec 25
          Send-Response $stream 200 "text/html; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes($response.Content))
        } catch {
          Send-Response $stream 502 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("No se pudo leer IGN: $($_.Exception.Message)"))
        }
      } else {
        $full = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $path))
        if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not [IO.File]::Exists($full)) {
          Send-Response $stream 404 "text/plain; charset=utf-8" ([Text.Encoding]::UTF8.GetBytes("Not found"))
        } else {
          Send-Response $stream 200 (Get-ContentType $full) ([IO.File]::ReadAllBytes($full))
        }
      }
    } finally {
      $client.Close()
    }
  }
} finally {
  $listener.Stop()
}
