[CmdletBinding()]
param(
    [switch]$EnableDebug,
    [ValidateSet(11, 12)][int]$CepMajor = 11
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'This installer supports Windows only.' }

function Assert-NoReparsePoint([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $cursor = $fullPath
    while ($null -ne $cursor -and $cursor.Length -gt 0) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw ('Refusing a reparse-point path: ' + $cursor)
            }
        }
        $parent = [System.IO.Directory]::GetParent($cursor)
        if ($null -eq $parent -or $parent.FullName -eq $cursor) { break }
        $cursor = $parent.FullName
    }
}

function Assert-RegularFile([string]$Path) {
    Assert-NoReparsePoint $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw ('Missing package file: ' + $Path) }
}

function Assert-SafeTree([string]$Path) {
    Assert-NoReparsePoint $Path
    if (Test-Path -LiteralPath $Path -PathType Container) {
        foreach ($item in Get-ChildItem -LiteralPath $Path -Force) {
            Assert-NoReparsePoint $item.FullName
            if ($item.PSIsContainer) { Assert-SafeTree $item.FullName }
        }
    }
}

function Assert-ChildPath([string]$Path, [string]$Parent) {
    if (-not [System.IO.Path]::GetFullPath($Path).StartsWith([System.IO.Path]::GetFullPath($Parent) + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw ('Install path escapes its directory: ' + $Path) }
}

function Read-PackageXml([string]$Path) {
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create($Path, $settings)
    try {
        $document = New-Object System.Xml.XmlDocument
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    } finally { $reader.Dispose() }
}

function Get-Sha256Base64([string]$Path) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($Path)
    try { return [Convert]::ToBase64String($sha256.ComputeHash($stream)) }
    finally { $stream.Dispose(); $sha256.Dispose() }
}

function Assert-SignedPayload([string]$Root, [string[]]$PayloadFiles) {
    $signature = Read-PackageXml (Join-Path $Root 'META-INF\signatures.xml')
    $namespaces = New-Object System.Xml.XmlNamespaceManager($signature.NameTable)
    $namespaces.AddNamespace('ds', 'http://www.w3.org/2000/09/xmldsig#')
    $manifests = $signature.SelectNodes('//ds:Manifest[@Id="PackageContents"]', $namespaces)
    if ($manifests.Count -ne 1) { throw 'Invalid CEP signature package manifest.' }
    $references = $manifests[0].SelectNodes('ds:Reference', $namespaces)
    if ($references.Count -ne $PayloadFiles.Count) { throw 'CEP signature does not cover the complete payload.' }
    $seen = @{}
    foreach ($reference in $references) {
        $relative = $reference.GetAttribute('URI')
        if ($PayloadFiles -cnotcontains $relative -or $seen.ContainsKey($relative)) { throw ('Invalid CEP signature file reference: ' + $relative) }
        $seen[$relative] = $true
        $method = $reference.SelectSingleNode('ds:DigestMethod', $namespaces)
        $digest = $reference.SelectSingleNode('ds:DigestValue', $namespaces)
        if ($null -eq $method -or $method.GetAttribute('Algorithm') -ne 'http://www.w3.org/2001/04/xmlenc#sha256' -or $null -eq $digest) { throw 'Unsupported CEP signature digest.' }
        $file = Join-Path $Root $relative
        Assert-RegularFile $file
        $actual = Get-Sha256Base64 $file
        if ($actual -cne $digest.InnerText.Trim()) { throw ('CEP payload integrity digest mismatch: ' + $relative) }
    }
}

if ([string]::IsNullOrWhiteSpace($env:APPDATA) -or -not [System.IO.Path]::IsPathRooted($env:APPDATA)) { throw 'APPDATA must be an absolute Windows path.' }
$extensionBase = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\extensions'))
$target = [System.IO.Path]::GetFullPath((Join-Path $extensionBase 'com.anshelf.receiver'))
Assert-ChildPath $target $extensionBase
$sourceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
if ($sourceRoot.Equals($target, [StringComparison]::OrdinalIgnoreCase) -or $sourceRoot.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) -or $target.StartsWith($sourceRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Run this script from a separate packaged plugin directory.' }
Assert-SafeTree $sourceRoot
Assert-NoReparsePoint $extensionBase
Assert-SafeTree $target
if ((Test-Path -LiteralPath $target) -and -not (Test-Path -LiteralPath $target -PathType Container)) { throw 'Existing CEP installation is not a directory.' }

$files = @('index.html','style.css','icon.png','panel.js','queue.cjs','insert-whole.jsfl','README.md','CSXS/manifest.xml')
foreach ($file in $files) {
    Assert-RegularFile (Join-Path $sourceRoot $file)
}
$hasMimeType = Test-Path -LiteralPath (Join-Path $sourceRoot 'mimetype')
$hasMetadata = Test-Path -LiteralPath (Join-Path $sourceRoot 'META-INF')
if ($hasMimeType -ne $hasMetadata -or ($hasMetadata -and -not (Test-Path -LiteralPath (Join-Path $sourceRoot 'META-INF\signatures.xml') -PathType Leaf))) { throw 'Incomplete CEP signature metadata; use the complete signed package.' }
$signed = $hasMimeType -and $hasMetadata
if ($signed) {
    Assert-RegularFile (Join-Path $sourceRoot 'mimetype')
    Assert-RegularFile (Join-Path $sourceRoot 'META-INF\signatures.xml')
    if ([System.IO.File]::ReadAllText((Join-Path $sourceRoot 'mimetype')) -cne 'application/vnd.adobe.air-ucf-package+zip') { throw 'Invalid CEP package mimetype.' }
    $payload = @($files) + @('mimetype')
    Assert-SignedPayload $sourceRoot $payload
    $files = $payload + @('META-INF/signatures.xml')
} elseif (-not $EnableDebug) {
    throw 'Unsigned CEP packages require explicit -EnableDebug for local development.'
}
$panelName = (Read-PackageXml (Join-Path $sourceRoot 'CSXS\manifest.xml')).ExtensionManifest.DispatchInfoList.Extension.DispatchInfo.UI.Menu

$suffix = [Guid]::NewGuid().ToString('N')
# Keep snapshots outside extensions so CEP cannot load a second copy of the same manifest.
$transactionBase = [System.IO.Path]::GetFullPath((Join-Path $env:APPDATA 'Adobe\CEP\AnShelfPluginBackups'))
$staging = Join-Path $transactionBase ('com.anshelf.receiver.staging-' + $suffix)
$backup = Join-Path $transactionBase ('com.anshelf.receiver.backup-' + $suffix)
$backedUp = $false
try {
    Assert-ChildPath $staging $transactionBase
    Assert-ChildPath $backup $transactionBase
    Assert-NoReparsePoint $transactionBase
    Assert-NoReparsePoint $staging
    Assert-NoReparsePoint $backup
    New-Item -ItemType Directory -Path (Join-Path $staging 'CSXS') -Force | Out-Null
    if ($signed) { New-Item -ItemType Directory -Path (Join-Path $staging 'META-INF') -Force | Out-Null }
    foreach ($file in $files) {
        $source = Join-Path $sourceRoot $file
        $destination = Join-Path $staging $file
        Assert-RegularFile $source
        Assert-NoReparsePoint $destination
        Copy-Item -LiteralPath $source -Destination $destination -Force
        Assert-RegularFile $destination
        if ((Get-Sha256Base64 $source) -cne (Get-Sha256Base64 $destination)) { throw ('Staging file integrity mismatch: ' + $file) }
    }
    Assert-SafeTree $staging
    if ($signed) { Assert-SignedPayload $staging $payload }
    Assert-NoReparsePoint $extensionBase
    Assert-NoReparsePoint $transactionBase
    New-Item -ItemType Directory -Path $extensionBase -Force | Out-Null
    Assert-SafeTree $target
    if (Test-Path -LiteralPath $target) {
        Move-Item -LiteralPath $target -Destination $backup
        $backedUp = $true
    }
    # Directory.Move refuses an existing target instead of nesting the package inside it.
    [System.IO.Directory]::Move($staging, $target)
} catch {
    $installError = $_
    if ($backedUp -and -not (Test-Path -LiteralPath $target)) {
        try {
            Assert-SafeTree $backup
            Assert-NoReparsePoint $target
            [System.IO.Directory]::Move($backup, $target)
        } catch { throw ('Installation failed and automatic rollback failed. Previous plugin is preserved at ' + $backup + '. ' + $installError.Exception.Message + ' Rollback: ' + $_.Exception.Message) }
    } elseif ($backedUp) {
        throw ('Installation failed because the target is occupied. The target was not overwritten; previous plugin is preserved at ' + $backup + '. ' + $installError.Exception.Message)
    }
    throw $installError
} finally {
    if (Test-Path -LiteralPath $staging) {
        Assert-ChildPath $staging $transactionBase
        Assert-SafeTree $staging
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}

if ($EnableDebug) {
    $registryPath = 'HKCU:\Software\Adobe\CSXS.' + $CepMajor
    New-Item -Path $registryPath -Force | Out-Null
    New-ItemProperty -Path $registryPath -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
    Write-Output ('Enabled CEP ' + $CepMajor + ' unsigned-extension development mode for the current user.')
} else { Write-Output 'CEP debug registry settings were not changed.' }

Write-Output ('Plugin copied to: ' + $target)
if ($backedUp) { Write-Output ('Previous plugin preserved at: ' + $backup) }
Write-Output ('Restart Animate 2023 or 2024, then open Window > Extensions > ' + $panelName + '.')
