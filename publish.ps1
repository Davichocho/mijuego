# Compila el servidor y publica un paquete completo de IIS.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$publishDirectory = Join-Path $projectRoot 'publish'
$archivePath = Join-Path $projectRoot 'campo-iis.zip'
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 6)
$stagingDirectory = Join-Path $projectRoot ('.publish-' + $stamp)
$backupDirectory = Join-Path (Join-Path $projectRoot 'publish-backups') $stamp
function Assert-ProjectPath([string]$candidate) {
    $full = [IO.Path]::GetFullPath($candidate)
    if (-not $full.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "La ruta debe estar dentro del proyecto: $full"
    }
    if ((Test-Path -LiteralPath $full) -and ((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "No se puede publicar sobre un enlace de directorio: $full"
    }
}
foreach ($path in @($publishDirectory, $stagingDirectory, $backupDirectory, (Split-Path $backupDirectory), $archivePath)) { Assert-ProjectPath $path }
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw 'Instala el SDK de .NET 8 o superior para generar la publicación.' }
& dotnet publish (Join-Path $projectRoot 'server/Campo.csproj') -c Release -o $stagingDirectory --self-contained false -p:UseAppHost=false --nologo
if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación. La publicación anterior no se modificó.' }
foreach ($required in @('Campo.dll', 'Campo.deps.json', 'Campo.runtimeconfig.json', 'web.config', 'wwwroot/index.html', 'wwwroot/online.js', 'wwwroot/skeeball.html', 'wwwroot/skeeball.js', 'wwwroot/skeeball.css', 'wwwroot/tanks.html', 'wwwroot/tanks.css', 'wwwroot/tanks.js', 'wwwroot/tank-motion.js', 'wwwroot/room-chat.js', 'wwwroot/room-chat.css')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stagingDirectory $required) -PathType Leaf)) { throw "Falta un archivo publicado: $required" }
}
[xml]$config = Get-Content -LiteralPath (Join-Path $stagingDirectory 'web.config') -Raw
if ($config.configuration.location.'system.webServer'.aspNetCore.arguments -notlike '*Campo.dll*') { throw 'La configuración de IIS no apunta al servidor Campo.' }
if (Test-Path -LiteralPath $publishDirectory) {
    New-Item -ItemType Directory -Path (Split-Path $backupDirectory) -Force | Out-Null
    Move-Item -LiteralPath $publishDirectory -Destination $backupDirectory
    Write-Output "Publicación anterior conservada: $backupDirectory"
}
Move-Item -LiteralPath $stagingDirectory -Destination $publishDirectory
$packageFiles = Get-ChildItem -LiteralPath $publishDirectory | Select-Object -ExpandProperty FullName
Compress-Archive -LiteralPath $packageFiles -DestinationPath $archivePath -Force
Write-Output "Publicación IIS: $publishDirectory"
Write-Output "Paquete: $archivePath"
Write-Output 'Requisito en IIS: Hosting Bundle de .NET 8 (x64). Publica la carpeta completa, incluida wwwroot.'
