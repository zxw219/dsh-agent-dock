param([ValidateSet('sidebar','open')][string]$Operation = 'sidebar')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Add-Type -Path (Join-Path $PSScriptRoot 'WorkBuddyBridge.cs') -ReferencedAssemblies Accessibility,System.Collections,System.Runtime,System.Runtime.InteropServices,System.Text.Encoding.Extensions,System.Threading.Thread -IgnoreWarnings -WarningAction SilentlyContinue
    if ($Operation -eq 'open') {
        $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
        [WorkBuddyBridge]::Open([string]$request.window, [string]$request.key, [string]$request.group, [string]$request.title) | ConvertTo-Json -Depth 12 -Compress
    } else {
        [WorkBuddyBridge]::Sidebar() | ConvertTo-Json -Depth 12 -Compress
    }
} catch {
    @{ ok = $false; error = $_.Exception.GetBaseException().Message } | ConvertTo-Json -Compress
    exit 1
}
