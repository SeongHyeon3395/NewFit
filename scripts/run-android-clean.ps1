$ErrorActionPreference = 'Stop'

$packageName = 'com.front'

function Write-Step($message) {
  Write-Host "`n==> $message" -ForegroundColor Cyan
}

function Get-DataInfo() {
  adb shell df -h /data | Select-Object -Last 1
}

Write-Step 'ADB 기기 확인'
$devices = adb devices
$onlineDevice = $devices | Select-String -Pattern "emulator-|device$"
if (-not $onlineDevice) {
  throw '연결된 안드로이드 에뮬레이터/기기가 없습니다.'
}

Write-Step '현재 /data 저장공간 확인'
$before = Get-DataInfo
Write-Host $before

Write-Step '기존 앱 제거'
adb uninstall $packageName | Out-Host

Write-Step '설치 직전 /data 저장공간 재확인'
$after = Get-DataInfo
Write-Host $after

if ($after -match '\s(\d+(?:\.\d+)?)G\s+\d+%\s+/data') {
  $freeGb = [double]$Matches[1]
  if ($freeGb -lt 1.2) {
    Write-Warning '에뮬레이터 여유 공간이 1.2GB 미만입니다. 다시 실패하면 Device Manager에서 Wipe Data를 먼저 실행하세요.'
  }
}

Write-Step '안드로이드 앱 재설치'
npx react-native run-android