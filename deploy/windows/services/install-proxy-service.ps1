$node = (Get-Command node).Source
$dir = "E:\CK Projects\CitykartDesk\services\proxy"

& nssm.exe install CitykartProxy $node
& nssm.exe set CitykartProxy AppParameters 'server.js'
& nssm.exe set CitykartProxy AppDirectory $dir
& nssm.exe set CitykartProxy AppStdout "$dir\service-stdout.log"
& nssm.exe set CitykartProxy AppStderr "$dir\service-stderr.log"
& nssm.exe set CitykartProxy Start SERVICE_AUTO_START
& nssm.exe start CitykartProxy
