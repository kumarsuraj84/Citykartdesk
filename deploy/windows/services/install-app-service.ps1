$node = (Get-Command node).Source
$dir = "E:\CK Projects\CitykartDesk\app\.next\standalone"

& nssm.exe install CitykartApp $node
& nssm.exe set CitykartApp AppParameters 'server.js'
& nssm.exe set CitykartApp AppDirectory $dir
& nssm.exe set CitykartApp AppEnvironmentExtra "PORT=3210" "HOSTNAME=0.0.0.0"
& nssm.exe set CitykartApp AppStdout "$dir\service-stdout.log"
& nssm.exe set CitykartApp AppStderr "$dir\service-stderr.log"
& nssm.exe set CitykartApp Start SERVICE_AUTO_START
& nssm.exe start CitykartApp
