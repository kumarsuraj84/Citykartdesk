$node = (Get-Command node).Source
$dir = "E:\CK Projects\CitykartDesk\services\storage-src"
$script = "$dir\dist\start\server.js"

& nssm.exe install CitykartStorage $node
& nssm.exe set CitykartStorage AppParameters "`"$script`""
& nssm.exe set CitykartStorage AppDirectory $dir
& nssm.exe set CitykartStorage AppEnvironmentExtra "NODE_ENV=production"
& nssm.exe set CitykartStorage AppStdout "$dir\service-stdout.log"
& nssm.exe set CitykartStorage AppStderr "$dir\service-stderr.log"
& nssm.exe set CitykartStorage Start SERVICE_AUTO_START
& nssm.exe start CitykartStorage
