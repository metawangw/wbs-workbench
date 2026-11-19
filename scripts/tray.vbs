' WBS Workbench - hidden system tray launcher.
' Invoked by background_start.bat. Runs tray.ps1 with a hidden window (style 0)
' and does not wait, so the notification-area icon survives after the batch
' window closes. Only PowerShell 5.1 (built into Windows) is required.
Option Explicit

Dim fso, shell, root, scriptPath, ps, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("Wscript.Shell")

root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
scriptPath = root & "\scripts\tray.ps1"

ps = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
If Not fso.FileExists(ps) Then
  ps = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
End If

cmd = """" & ps & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """"

If WScript.Arguments.Count > 0 Then
  Dim i
  For i = 0 To WScript.Arguments.Count - 1
    cmd = cmd & " " & WScript.Arguments(i)
  Next
End If

shell.Run cmd, 0, False
