# Fix DPD API encoding issue
$content = Get-Content "dpd-api.js" -Raw -Encoding UTF8
$fixed = $content -replace [char]0x2018 + [char]0x2019, "'"
Set-Content "dpd-api.js" -Value $fixed -Encoding UTF8
Write-Host "Fixed"
