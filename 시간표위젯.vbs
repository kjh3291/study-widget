' 에브리타임 시간표 위젯 실행기 (콘솔 창 없이 조용히 실행)
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = scriptDir
sh.Run """" & scriptDir & "\node_modules\.bin\electron.cmd"" .", 0, False
