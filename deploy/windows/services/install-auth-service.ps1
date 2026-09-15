$exe = "E:\CK Projects\CitykartDesk\services\auth\auth.exe"
$dir = "E:\CK Projects\CitykartDesk\services\auth"

& nssm.exe install CitykartAuth $exe
& nssm.exe set CitykartAuth AppDirectory $dir
& nssm.exe set CitykartAuth AppStdout "$dir\service-stdout.log"
& nssm.exe set CitykartAuth AppStderr "$dir\service-stderr.log"
& nssm.exe set CitykartAuth Start SERVICE_AUTO_START
& nssm.exe start CitykartAuth
