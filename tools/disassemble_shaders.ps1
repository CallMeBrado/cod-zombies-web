param([string]$Zone = 'nacht')
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$env:TEMP = Join-Path $taskRoot '.cache\temp'
$env:TMP = $env:TEMP
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WaWShaderReader {
  [DllImport("d3dcompiler_47.dll", CallingConvention=CallingConvention.StdCall)]
  static extern int D3DDisassemble(byte[] data, UIntPtr size, uint flags, string comments, out IntPtr blob);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate IntPtr Buffer(IntPtr self);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate UIntPtr Size(IntPtr self);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint Release(IntPtr self);
  public static string Read(byte[] data) {
    IntPtr blob; Marshal.ThrowExceptionForHR(D3DDisassemble(data,(UIntPtr)data.Length,0,null,out blob));
    IntPtr vt=Marshal.ReadIntPtr(blob);
    var buffer=Marshal.GetDelegateForFunctionPointer<Buffer>(Marshal.ReadIntPtr(vt,3*IntPtr.Size));
    var size=Marshal.GetDelegateForFunctionPointer<Size>(Marshal.ReadIntPtr(vt,4*IntPtr.Size));
    string result=Marshal.PtrToStringAnsi(buffer(blob),(int)size(blob).ToUInt64());
    Marshal.GetDelegateForFunctionPointer<Release>(Marshal.ReadIntPtr(vt,2*IntPtr.Size))(blob);
    return result;
  }
}
'@
foreach ($taskFile in Get-ChildItem -LiteralPath (Join-Path $taskRoot "local-data\$Zone\web-shaders") -Filter '*.cso') {
  [WaWShaderReader]::Read([IO.File]::ReadAllBytes($taskFile.FullName)) | Set-Content -LiteralPath ($taskFile.FullName + '.txt')
}
