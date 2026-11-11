$k = (Get-Clipboard -Raw).Trim()
if ($k.Length -lt 16 -or $k -match '\s') { "clipboard does not look like a key (len=$($k.Length))"; exit 1 }
$p = 'C:\For Claude\pace-prompter\.env'
[System.IO.File]::WriteAllText($p, "SMARTSPECTRA_API_KEY=$k`n")
Set-Clipboard -Value ' '
"written len=$($k.Length)"
