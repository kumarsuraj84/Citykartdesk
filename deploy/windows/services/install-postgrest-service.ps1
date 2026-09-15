$exe = "E:\CK Projects\CitykartDesk\services\postgrest\postgrest.exe"
$dir = "E:\CK Projects\CitykartDesk\services\postgrest"

& nssm.exe install CitykartPostgrest $exe
# AppParameters must be a path with NO spaces - nssm re-tokenizes this string
# itself when building the launch command line, and does not reliably respect
# quoting passed through PowerShell -> nssm.exe for a value containing spaces.
# Using a relative filename (resolved against AppDirectory below) avoids the
# whole class of bug instead of fighting nssm's quoting.
& nssm.exe set CitykartPostgrest AppParameters 'postgrest.conf'
& nssm.exe set CitykartPostgrest AppDirectory $dir
& nssm.exe set CitykartPostgrest AppStdout "$dir\service-stdout.log"
& nssm.exe set CitykartPostgrest AppStderr "$dir\service-stderr.log"
& nssm.exe set CitykartPostgrest Start SERVICE_AUTO_START
& nssm.exe start CitykartPostgrest
