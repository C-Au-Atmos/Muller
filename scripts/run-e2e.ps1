$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$specifications = Get-ChildItem -LiteralPath (Join-Path $repositoryRoot "e2e") -Filter "*.spec.ts" |
    Sort-Object Name

Push-Location $repositoryRoot
try {
    foreach ($specification in $specifications) {
        Write-Host "Running $($specification.Name)"
        $testPath = "e2e/$($specification.Name)"
        & npx.cmd playwright test $testPath --workers=1
        if ($LASTEXITCODE -ne 0) {
            throw "Playwright failed for $($specification.Name) with exit code $LASTEXITCODE"
        }
    }
}
finally {
    Pop-Location
}
