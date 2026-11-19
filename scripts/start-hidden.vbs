' WBS Workbench - hidden background launcher.
' Invoked by background_start.bat. Starts the Node launcher DIRECTLY with a
' hidden window (style 0) and does not wait. No intermediate cmd.exe is used,
' so no conhost/blank window is created and nothing keeps the service attached
' to the console of the window that launched it.
Option Explicit

Dim fso, root, launcher, extra, i, cmd, shell, arch, nodeExe, forced
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
launcher = root & "\scripts\launch.mjs"

extra = ""
For i = 0 To WScript.Arguments.Count - 1
  extra = extra & " " & WScript.Arguments(i)
Next

' Pick the bundled runtime that matches the OS architecture. A 32-bit
' wscript.exe on 64-bit Windows exposes PROCESSOR_ARCHITEW6432=AMD64.
Set shell = CreateObject("Wscript.Shell")
arch = shell.ExpandEnvironmentStrings("%PROCESSOR_ARCHITEW6432%")
If arch = "%PROCESSOR_ARCHITEW6432%" Or arch = "" Then
  arch = shell.ExpandEnvironmentStrings("%PROCESSOR_ARCHITECTURE%")
End If
forced = LCase(shell.ExpandEnvironmentStrings("%WBS_NODE_ARCH%"))
If forced = "x86" Or forced = "x64" Then arch = forced
If LCase(arch) = "x86" Then
  nodeExe = root & "\runtime\x86\node.exe"
Else
  nodeExe = root & "\runtime\x64\node.exe"
End If
If Not fso.FileExists(nodeExe) Then nodeExe = "node"

cmd = """" & nodeExe & """ """ & launcher & """ --background" & extra
shell.Run cmd, 0, False
