param(
  [int]$Port = 9444,
  [int]$Attempts = 3
)

$ErrorActionPreference = 'Continue'
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$root = Split-Path -Parent $PSScriptRoot

for ($i = 1; $i -le $Attempts; $i++) {
  $prof = "D:\Deepseek\.tmp-edge-$i"
  $out  = "D:\Deepseek\.tmp-edge-$i-out.log"
  $err  = "D:\Deepseek\.tmp-edge-$i-err.log"
  New-Item -ItemType Directory -Force -Path $prof | Out-Null

  Write-Output "== attempt $i (port $Port) =="
  $p = Start-Process -FilePath $edge -ArgumentList @(
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=$Port", "--remote-allow-origins=*",
    "--user-data-dir=$prof", "--window-size=390,844", "about:blank"
  ) -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err

  $up = $false
  for ($k = 0; $k -lt 40; $k++) {
    Start-Sleep -Milliseconds 500
    try {
      $r = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 3
      Write-Output "CDP ready: $($r.Browser)"
      $up = $true
      break
    } catch { }
  }

  if (-not $up) {
    Write-Output "CDP not ready; stderr tail:"
    if (Test-Path $err) { Get-Content $err -Tail 6 }
    if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    continue
  }

  $env:CDP_PORT = "$Port"
  $env:TEST_URL = "http://127.0.0.1:8765/index.html"
  $node = (Get-Command node).Source
  $nodeOut = "$root\tests\console.txt"
  $nodeErr = "$root\tests\console-err.txt"
  $np = Start-Process -FilePath $node -ArgumentList @("$root\tests\cdp-smoke.mjs") -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $nodeOut -RedirectStandardError $nodeErr
  $code = $np.ExitCode
  Write-Output "TEST_EXIT=$code"
  Write-Output "REPORT=$root\tests\last-report.txt (exists: $(Test-Path "$root\tests\last-report.txt"))"
  Write-Output "STDOUT_BYTES=$((Get-Item $nodeOut -ErrorAction SilentlyContinue).Length)"

  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
  exit $code
}

Write-Output "could not start headless browser"
exit 3
