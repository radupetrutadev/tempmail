<#
.SYNOPSIS
    Minimal static file server for Tempbox.

.DESCRIPTION
    Tempbox is a plain static site - you can open index.html straight from
    disk. Serving it over http:// is nicer though: the Clipboard API and
    localStorage behave normally on a real origin, which they do not always do
    on file://.

    Uses only .NET types that ship with Windows, so there is nothing to
    install. Runs as a standard user (the "localhost" prefix needs no
    administrator rights or URL ACL reservation).

.PARAMETER Port
    TCP port to listen on. Default 8080.

.PARAMETER NoBrowser
    Do not open the default browser on startup.

.EXAMPLE
    .\serve.ps1
    .\serve.ps1 -Port 3000 -NoBrowser
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8080,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

$mime = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.webp' = 'image/webp'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
}

function Resolve-RequestPath {
    param([string]$UrlPath)

    $decoded = [System.Uri]::UnescapeDataString($UrlPath)
    $decoded = $decoded -replace '/+', '/'
    if ($decoded -eq '/' -or [string]::IsNullOrWhiteSpace($decoded)) { $decoded = '/index.html' }

    $relative = $decoded.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

    # Refuse anything that escapes the site root.
    $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
    if (-not $candidate.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }

    if (Test-Path -LiteralPath $candidate -PathType Container) {
        $candidate = Join-Path $candidate 'index.html'
    }
    return $candidate
}

$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "Could not listen on $prefix" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Port $Port may already be in use. Try: .\serve.ps1 -Port 8081" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  Tempbox is running" -ForegroundColor Green
Write-Host "  $prefix" -ForegroundColor Cyan
Write-Host "  serving $root"
Write-Host "  press Ctrl+C to stop"
Write-Host ""

if (-not $NoBrowser) { Start-Process $prefix | Out-Null }

try {
    while ($listener.IsListening) {
        # Async accept so Ctrl+C is not swallowed by a blocking GetContext().
        $task = $listener.GetContextAsync()
        while (-not $task.AsyncWaitHandle.WaitOne(200)) { }
        $context = $task.GetAwaiter().GetResult()

        $request = $context.Request
        $response = $context.Response
        $status = 200

        try {
            $path = Resolve-RequestPath -UrlPath $request.Url.AbsolutePath

            if ($null -ne $path -and (Test-Path -LiteralPath $path -PathType Leaf)) {
                $bytes = [System.IO.File]::ReadAllBytes($path)
                $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
                $type = $mime[$ext]
                if (-not $type) { $type = 'application/octet-stream' }

                $response.ContentType = $type
                $response.Headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $status = 404
                $body = [System.Text.Encoding]::UTF8.GetBytes('<h1>404 - not found</h1>')
                $response.StatusCode = 404
                $response.ContentType = 'text/html; charset=utf-8'
                $response.ContentLength64 = $body.Length
                $response.OutputStream.Write($body, 0, $body.Length)
            }
        } catch {
            $status = 500
            try {
                $response.StatusCode = 500
                $body = [System.Text.Encoding]::UTF8.GetBytes('<h1>500 - server error</h1>')
                $response.ContentLength64 = $body.Length
                $response.OutputStream.Write($body, 0, $body.Length)
            } catch { }
        } finally {
            try { $response.OutputStream.Close() } catch { }
            try { $response.Close() } catch { }
        }

        $colour = if ($status -eq 200) { 'DarkGray' } else { 'Yellow' }
        Write-Host ("  {0}  {1}  {2}" -f $status, $request.HttpMethod, $request.Url.AbsolutePath) -ForegroundColor $colour
    }
} finally {
    try { $listener.Stop(); $listener.Close() } catch { }
    Write-Host ""
    Write-Host "  Tempbox stopped." -ForegroundColor DarkGray
}
