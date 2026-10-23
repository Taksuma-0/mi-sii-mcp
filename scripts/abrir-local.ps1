$ErrorActionPreference = 'Stop'
$raizProyecto = Split-Path -Parent $PSScriptRoot
try {
    $nodeLocal = (Get-Command node -ErrorAction Stop).Source
    # WorkingDirectory resuelve tsx y el script sin interpolar datos del formulario.
    Start-Process -FilePath $nodeLocal -ArgumentList @('--import', 'tsx', 'scripts/abrir-local.ts') -WorkingDirectory $raizProyecto -WindowStyle Hidden
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('No se pudo abrir impuestocl. Comprueba Node y vuelve a intentarlo.', 'impuestocl') | Out-Null
}
