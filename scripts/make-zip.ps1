# Пакует содержимое dist в один архив для загрузки в Cloudflare Pages.
#
# Две тонкости, из-за которых архив собирается вручную, а не через
# CreateFromDirectory:
#   1) в корне архива должны лежать сами файлы (index.html, _headers, ...),
#      а не папка dist — иначе Pages не найдёт точку входа;
#   2) спецификация ZIP требует прямые слеши в путях, а CreateFromDirectory
#      на .NET Framework пишет обратные, и распаковка ломается.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$zip  = Join-Path $root "dist.zip"

if (-not (Test-Path $dist)) {
    Write-Error "Папки dist нет — сначала выполните npm run build"
}

if (Test-Path $zip) { Remove-Item $zip -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$distFull = (Resolve-Path $dist).Path.TrimEnd('\')
$files = @(Get-ChildItem $dist -Recurse -File)

$stream  = [System.IO.File]::Open($zip, [System.IO.FileMode]::Create)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)

try {
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($distFull.Length + 1).Replace('\', '/')
        $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
        $dst = $entry.Open()
        $src = [System.IO.File]::OpenRead($f.FullName)
        try { $src.CopyTo($dst) } finally { $src.Dispose(); $dst.Dispose() }
    }
} finally {
    $archive.Dispose()
    $stream.Dispose()
}

$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)

Write-Host "Готово: $zip"
Write-Host "  файлов внутри: $($files.Count)"
Write-Host "  размер архива: $sizeMb MB"
