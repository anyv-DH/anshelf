param(
    [Parameter(Mandatory = $true)][int]$ManagerProcessId,
    [Parameter(Mandatory = $true)][string]$UpdateExecutable,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathRooted($UpdateExecutable) -or [System.IO.Path]::GetExtension($UpdateExecutable) -ne '.exe') { throw 'Invalid update executable.' }
$item = Get-Item -LiteralPath $UpdateExecutable
if ($item.PSIsContainer -or ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw 'Invalid update executable.' }
# The main process has already verified the official release digest. Wait for
# its normal shutdown so portable single-instance detection cannot eat launch.
$manager = Get-Process -Id $ManagerProcessId -ErrorAction SilentlyContinue
if ($null -ne $manager) { Wait-Process -Id $ManagerProcessId -Timeout 30 -ErrorAction Stop }
if ((Get-FileHash -LiteralPath $UpdateExecutable -Algorithm SHA256).Hash -ine $ExpectedSha256) { throw 'Update executable digest mismatch.' }
Start-Process -FilePath $UpdateExecutable
