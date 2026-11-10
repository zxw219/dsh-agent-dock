param([ValidateSet('sidebar','open','serve')][string]$Operation = 'sidebar')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'WorkBuddyBridge.cs') -ReferencedAssemblies Accessibility,System.Collections,System.Runtime,System.Runtime.InteropServices,System.Text.Encoding.Extensions,System.Threading.Thread -IgnoreWarnings -WarningAction SilentlyContinue
    if ($Operation -eq 'serve') {
        while ($line = [Console]::In.ReadLine()) {
            $id = $null
            try {
                if ($line.Length -gt 32768) { throw 'Reader request exceeds limit' }
                $message = $line | ConvertFrom-Json
                $id = $message.id
                if ($message.operation -eq 'sidebar') { $result = [WorkBuddyBridge]::Sidebar() }
                elseif ($message.operation -eq 'open') {
                    $r = $message.request
                    $result = [WorkBuddyBridge]::Open([string]$r.window, [string]$r.key, [string]$r.group, [string]$r.title)
                } else { throw 'Invalid reader operation' }
                @{ id = $id; ok = $true; result = $result } | ConvertTo-Json -Depth 12 -Compress
            } catch {
                @{ id = $id; ok = $false; error = $_.Exception.GetBaseException().Message } | ConvertTo-Json -Compress
            }
            [Console]::Out.Flush()
        }
    } elseif ($Operation -eq 'open') {
        $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
        [WorkBuddyBridge]::Open([string]$request.window, [string]$request.key, [string]$request.group, [string]$request.title) | ConvertTo-Json -Depth 12 -Compress
    } else {
        [WorkBuddyBridge]::Sidebar() | ConvertTo-Json -Depth 12 -Compress
    }
} catch {
    @{ ok = $false; error = $_.Exception.GetBaseException().Message } | ConvertTo-Json -Compress
    exit 1
}
