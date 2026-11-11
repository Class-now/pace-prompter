param([string]$Video, [string]$Prio = 'BelowNormal', [int]$TimeoutSec = 240,
      [string]$Log = 'C:\For Claude\pace-prompter\out\sdk-smoke.log')
$p = Start-Process -FilePath 'node' -ArgumentList @('test/sdk-smoke.mjs', "`"$Video`"") -WorkingDirectory 'C:\For Claude\pace-prompter' `
  -RedirectStandardOutput $Log -RedirectStandardError "$Log.err" -NoNewWindow -PassThru
$p.PriorityClass = $Prio
if (-not $p.WaitForExit($TimeoutSec * 1000)) {
  Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -EA SilentlyContinue }
  Stop-Process -Id $p.Id -Force
  'TIMEOUT'
}
"exit=$($p.ExitCode)"
Get-Content $Log
Get-Content "$Log.err" | Select-String -NotMatch 'inference_feedback_manager|landmark_projection' | Select-Object -Last 12
