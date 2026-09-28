<#
  AudioGubbins launcher (PowerShell).

    .\Run.ps1                      # start the development server (hot reload)
    .\Run.ps1 preview              # production build, then serve the built application
    .\Run.ps1 -BindHost localhost  # bind and open through localhost instead of 127.0.0.1
    .\Run.ps1 -Port 8080           # pin a port instead of the default (5173 dev, 4180 preview)
    .\Run.ps1 -NoOpen              # start the server without opening a browser
    .\Run.ps1 -Browser firefox     # open the application in a named browser

  If Windows refuses the script with an execution-policy error, run Run.bat, or:
    powershell -ExecutionPolicy Bypass -File .\Run.ps1

  Running this leaves you in the application in your browser, whether or not a server was
  already up:

    1. If a development server started from THIS checkout already answers on a port in the
       range, the launcher opens the browser there and exits. It starts no second server. That
       includes a server started by `pnpm dev` rather than by this launcher, which Vite binds to
       the IPv6 loopback: the launcher opens the address the server is bound to.
    2. Otherwise it installs the locked dependencies, starts the server, waits until the page
       answers, and only then opens the browser, so the browser never meets a port that is not
       ready or not ours. The server runs in the foreground: Ctrl+C stops the whole node and
       Vite tree. The window's close button can orphan it on the port.

  A server is recognised as ours by the process that owns the port, not merely by what answers
  there. Sibling Vite projects default to the same port 5173, and every git worktree of this
  repository runs the same application with its own code, so a page that looks right can still
  come from another checkout. The owning process's command line names the Vite it runs, and that
  lies inside the checkout it was started from. An occupied port that is not ours is skipped.
  Browser storage belongs to the origin, port included, so a different port opens an empty
  project store. Pass -Port to pin one and always come back to the same data.

  Host: the server binds, and the browser opens, the IPv4 loopback address 127.0.0.1 rather than
  the name localhost. On Windows localhost resolves to both ::1 and 127.0.0.1, Vite binds only
  one, and a browser that tries the other first shows "unable to connect" until it is reloaded.
  Pass -BindHost localhost (or set AUDIOGUBBINS_DEV_HOST=localhost) to keep the localhost origin.
  Vite is then bound on every interface, so localhost always finds a socket, at the cost of a
  Windows Firewall prompt and a server that the local network can reach.

  Preview port: the default is 4180, not Vite's 4173, because the browser suite serves its own
  builds on 4173 and 4174 and refuses to start when either is taken.

  Base path: AUDIOGUBBINS_BASE, which vite.config.ts reads, is honoured here too, so the browser
  opens the path the server actually serves.

  Browser: the URL goes to the default browser through the operating system, which hands it to
  a browser that is already running instead of starting a competing one. -Browser <exe or path>
  (or the BROWSER environment variable) names another, and -NoOpen or -Browser none opens none.
#>
[CmdletBinding()]
param(
  [ValidateSet('dev', 'preview')]
  [string]$Mode = 'dev',

  # The host Vite binds and the browser opens. See the header for why it is not localhost.
  [string]$BindHost = $(if ($env:AUDIOGUBBINS_DEV_HOST) { $env:AUDIOGUBBINS_DEV_HOST } else { '127.0.0.1' }),

  # 0 picks the default port and moves up past any port something else holds. Any other value
  # is used exactly: an occupied pinned port stops the launcher, because a substitute would be a
  # different origin with different stored projects.
  [ValidateRange(0, 65535)]
  [int]$Port = 0,

  # A browser executable name or full path, or 'none'. Overrides the BROWSER environment variable.
  [string]$Browser = '',

  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'

# PowerShell 7.4+ turns a native command's non-zero exit code into a terminating error under
# 'Stop', which would replace the launcher's own messages with a stack dump. Windows PowerShell
# 5.1, which Run.bat runs, has no such behaviour, and this gives both the same one.
$PSNativeCommandUseErrorActionPreference = $false

Set-Location -LiteralPath $PSScriptRoot

$DevDefaultPort = 5173
$PreviewDefaultPort = 4180
$PortsToScan = 50
$ReadyTimeoutSec = 90

# The page title in apps/web/index.html. A server answering without it is not this application.
$AppTitle = '<title>AudioGubbins</title>'

# The path the server answers on, from the AUDIOGUBBINS_BASE that vite.config.ts reads. These are
# the answers Vite itself gives: a relative base ('./') is served at the root, a full URL at its
# path, a base without a leading slash is given one, and a missing trailing slash is added.
function Get-BasePath([string]$Base) {
  if (-not $Base) { return '/' }
  if ($Base.StartsWith('.')) { return '/' }
  if ($Base -match '^[a-z][a-z0-9+.-]*://') { $Base = ([Uri]$Base).AbsolutePath }
  if (-not $Base.StartsWith('/')) { $Base = "/$Base" }
  if (-not $Base.EndsWith('/')) { $Base += '/' }
  return $Base
}
$BasePath = Get-BasePath $env:AUDIOGUBBINS_BASE

# The host a browser opens for an address a server is bound to. A wildcard address is reached
# through the loopback of its family, which is what a browser can open. An IPv6 literal is
# bracketed in a URL.
function Get-UrlHost([string]$Address) {
  $address = switch ($Address) { '0.0.0.0' { '127.0.0.1' } '::' { '::1' } default { $Address } }
  return $(if ($address -match ':') { "[$address]" } else { $address })
}
$UrlHost = Get-UrlHost $BindHost

# Binding the name localhost binds one stack only, which is the race the default avoids, so it
# is bound on every interface instead.
$ViteHostArgs = if ($BindHost -ieq 'localhost') { @('--host') } else { @('--host', $BindHost) }

$BrowserChoice = if ($NoOpen) { 'none' } elseif ($Browser) { $Browser } elseif ($env:BROWSER) { $env:BROWSER } else { '' }
$AutoOpen = $BrowserChoice -ne 'none'

# The checkout's own directory with a trailing separator, so that this checkout never matches a
# sibling worktree whose name merely begins with the same text.
$CheckoutRoot = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'

function Write-Failure([string]$Message, [string]$Detail = '') {
  Write-Host "[ERROR] $Message" -ForegroundColor Red
  if ($Detail) { Write-Host "        $Detail" -ForegroundColor Red }
}

function Assert-LastExitCode([string]$Message) {
  if ($LASTEXITCODE -ne 0) {
    Write-Failure $Message
    exit 1
  }
}

function Get-AppUrl([int]$Port, [string]$Host_ = '') {
  $h = if ($Host_) { $Host_ } else { $UrlHost }
  return "http://${h}:$Port$BasePath"
}

# Every listening socket in the range, keyed by port, with the process that owns it and the
# addresses it is bound to. One query for the whole range, because each call to
# Get-NetTCPConnection costs a CIM round trip.
function Get-Listeners([int]$First, [int]$Last) {
  $listeners = @{}
  foreach ($connection in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
    $p = [int]$connection.LocalPort
    if ($p -lt $First -or $p -gt $Last) { continue }
    if (-not $listeners.ContainsKey($p)) {
      $listeners[$p] = @{ ProcessId = [int]$connection.OwningProcess; Addresses = @() }
    }
    $listeners[$p].Addresses += [string]$connection.LocalAddress
  }
  return $listeners
}

# Whether a command line is a development server's, run from the checkout at $Root. The Vite it
# runs is installed inside the checkout, so that path is on the command line of the node process
# that listens. `pnpm dev` passes Vite no arguments at all, so the name can end the line. A preview
# server of the same checkout is excluded: it serves whatever build it started with, not the
# source. Taking the command line rather than a process makes the decision testable.
function Test-DevServerCommandLine([string]$CommandLine, [string]$Root) {
  return $CommandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $CommandLine -match '[/\\]vite\.js"?(\s|$)' -and $CommandLine -notmatch '[/\\]vite\.js"?\s+"?preview\b'
}

# Whether the process is a development server started from this checkout.
function Test-OwnDevServer([int]$ProcessId) {
  $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process -or -not $process.CommandLine) { return $false }
  return Test-DevServerCommandLine $process.CommandLine $CheckoutRoot
}

# Whether the URL serves the application's page with the cross-origin isolation headers the
# server is configured to send.
function Test-AppAnswers([string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 4
  }
  catch {
    # Every failure answers the question the same way: a refused connection, a timeout or an
    # error status all mean no usable server. The exception types differ between Windows
    # PowerShell (WebException) and PowerShell 7 (HttpRequestException, TaskCanceledException),
    # so they are not listed.
    return $false
  }
  $coop = [string]$response.Headers['Cross-Origin-Opener-Policy']
  return $response.StatusCode -eq 200 -and $coop -eq 'same-origin' -and $response.Content.Contains($AppTitle)
}

# The range of ports to look at: the default and those above it, or only a pinned port.
function Get-PortRange([int]$Default) {
  if ($Port -gt 0) { return @($Port, $Port) }
  return @($Default, [Math]::Min($Default + $PortsToScan - 1, 65535))
}

# The URL of a development server from this checkout that serves the application, or ''. The
# address asked for is tried first, then the addresses the server is actually bound to: a server
# started by `pnpm dev` rather than by this launcher takes Vite's own default and binds the IPv6
# loopback alone, which the IPv4 address this launcher prefers cannot reach.
function Find-OwnServer([int]$Default) {
  $first, $last = Get-PortRange $Default
  $listeners = Get-Listeners $first $last
  foreach ($p in ($listeners.Keys | Sort-Object)) {
    $listener = $listeners[$p]
    if (-not (Test-OwnDevServer $listener.ProcessId)) { continue }
    $hosts = @($UrlHost) + @($listener.Addresses | ForEach-Object { Get-UrlHost $_ })
    foreach ($h in ($hosts | Select-Object -Unique)) {
      $url = Get-AppUrl $p $h
      if (Test-AppAnswers $url) { return $url }
    }
    Write-Host "[WARN] A server from this checkout holds port $p but serves no page there. Leaving it alone." -ForegroundColor Yellow
  }
  return ''
}

# The first port in the range that nothing listens on. Exits with the reason when there is none.
function Select-FreePort([int]$Default) {
  $first, $last = Get-PortRange $Default
  $listeners = Get-Listeners $first $last
  for ($p = $first; $p -le $last; $p++) {
    if ($listeners.ContainsKey($p)) { continue }
    if ($p -ne $first) { Write-Host "Port $first is in use by something else; using $p instead." -ForegroundColor Yellow }
    return $p
  }
  if ($Port -gt 0) {
    Write-Failure "Port $Port is in use by something else." 'It was pinned with -Port, so no other port is chosen. Free it, or pass a different one.'
  }
  else {
    Write-Failure "No free port between $first and $last."
  }
  exit 1
}

# Hands the URL to the named browser, or to the operating system's default browser, which passes
# it to a browser that is already running rather than starting another.
function Open-AppUrl([string]$Url, [string]$Browser) {
  if ($Browser) {
    try {
      Start-Process -FilePath $Browser -ArgumentList $Url -ErrorAction Stop
      return
    }
    catch [System.InvalidOperationException] {
      Write-Host "[WARN] Could not start '$Browser' ($($_.Exception.Message)). Using the default browser." -ForegroundColor Yellow
    }
  }
  try {
    Start-Process -FilePath $Url -ErrorAction Stop
  }
  catch [System.InvalidOperationException] {
    Write-Host "[WARN] Could not open a browser. Open $Url yourself." -ForegroundColor Yellow
  }
}

# A background job that waits for the application to answer at the URL and then opens it once, so
# the server can run in the foreground where Ctrl+C reaches it. A job runs in its own process and
# cannot see this script's functions, which is why it repeats the probe and the open in brief.
function Start-BrowserOpener([string]$Url, [string]$Browser) {
  return Start-Job -ArgumentList $Url, $Browser, $ReadyTimeoutSec, $AppTitle -ScriptBlock {
    param($Url, $Browser, $TimeoutSec, $AppTitle)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
      try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200 -and $response.Content.Contains($AppTitle)) {
          if ($Browser) {
            try { Start-Process -FilePath $Browser -ArgumentList $Url -ErrorAction Stop; return }
            catch [System.InvalidOperationException] { }
          }
          Start-Process -FilePath $Url
          return
        }
      }
      catch {
        # Not answering yet, whichever exception this PowerShell reports that with.
      }
      Start-Sleep -Milliseconds 400
    }
  }
}

# Whether the Node version satisfies package.json's engines.node. Understands the comparator forms
# the range uses (^, ~, >=, >, <=, <, =, and a bare version), space-separated sets joined by ||,
# and returns $null for anything else, so a range it cannot read is not reported as unmet.
function Test-NodeEngine([string]$Range, [version]$Node) {
  foreach ($set in $Range -split '\|\|') {
    $satisfied = $true
    foreach ($comparator in ($set.Trim() -split '\s+')) {
      if ($comparator -notmatch '^(\^|~|>=|>|<=|<|=)?v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$') { return $null }
      $operator = $Matches[1]
      $major = [int]$Matches[2]
      $minor = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
      $patch = if ($Matches[4]) { [int]$Matches[4] } else { 0 }
      $floor = [version]::new($major, $minor, $patch)
      $ok = switch ($operator) {
        # A caret range allows changes that do not touch the first non-zero part.
        '^' { $Node -ge $floor -and $Node.Major -eq $major -and ($major -ne 0 -or $Node.Minor -eq $minor) }
        '~' { $Node -ge $floor -and $Node.Major -eq $major -and ($Node.Minor -eq $minor -or -not $Matches[3]) }
        '>=' { $Node -ge $floor }
        '>' { $Node -gt $floor }
        '<=' { $Node -le $floor }
        '<' { $Node -lt $floor }
        default {
          # A bare or '=' version fixes only the parts it names.
          $Node.Major -eq $major -and (-not $Matches[3] -or $Node.Minor -eq $minor) -and (-not $Matches[4] -or $Node.Build -eq $patch)
        }
      }
      if (-not $ok) { $satisfied = $false; break }
    }
    if ($satisfied) { return $true }
  }
  return $false
}

Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host '  AudioGubbins - local-first audio editing in the browser' -ForegroundColor Cyan
Write-Host '==========================================================' -ForegroundColor Cyan
Write-Host ''

$manifest = Get-Content -LiteralPath 'package.json' -Raw | ConvertFrom-Json

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Failure 'Node.js was not found on your PATH.' "Install a Node.js version in the range $($manifest.engines.node) from https://nodejs.org, then run this again."
  exit 1
}

# Warn rather than stop: an unlisted version may still work, and the message names the likely
# cause if the build or server then fails in a way that does not.
$nodeVersion = (node --version).Trim()
if ($nodeVersion -match '^v(\d+\.\d+\.\d+)') {
  $meetsEngine = Test-NodeEngine $manifest.engines.node ([version]$Matches[1])
  if ($meetsEngine -eq $false) {
    Write-Host "[WARN] Node $nodeVersion is outside the range this project supports ($($manifest.engines.node))." -ForegroundColor Yellow
    Write-Host '       Continuing. If the install, build or server fails, change Node first.' -ForegroundColor Yellow
    Write-Host ''
  }
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  $pnpmVersion = ($manifest.packageManager -replace '^pnpm@', '')
  Write-Failure 'pnpm was not found on your PATH.' "Install it with: npm install --global pnpm@$pnpmVersion"
  exit 1
}

# A development server is reused before anything is installed, because the install could change
# the packages under a server that is running. A preview server is never reused: it would serve
# whatever build it started with.
if ($Mode -eq 'dev') {
  $ownUrl = Find-OwnServer $DevDefaultPort
  if ($ownUrl) {
    Write-Host "AudioGubbins from this checkout is already running at $ownUrl" -ForegroundColor Green
    if ($AutoOpen) { Open-AppUrl $ownUrl $BrowserChoice }
    exit 0
  }
}

# The installed tree has to match the lockfile, not merely exist: after a pull or a branch switch
# an old tree starts Vite and then fails on a missing or outdated package. With nothing to change
# this finishes in a moment, and it refuses to rewrite a lockfile that disagrees with a manifest.
Write-Host 'Checking dependencies against the lockfile...' -ForegroundColor Yellow
pnpm install --frozen-lockfile
Assert-LastExitCode 'Installing dependencies failed. See the messages above.'
Write-Host ''

if ($Mode -eq 'preview') {
  Write-Host 'Building the production bundle...' -ForegroundColor Yellow
  pnpm run build
  Assert-LastExitCode 'The build failed. See the messages above.'
  Write-Host ''
}

# The port is chosen after the install and the build, which can take minutes, so that it is still
# free when the server starts.
$serverPort = Select-FreePort $(if ($Mode -eq 'dev') { $DevDefaultPort } else { $PreviewDefaultPort })
$url = Get-AppUrl $serverPort

Write-Host "Starting AudioGubbins at $url" -ForegroundColor Green
if ($AutoOpen) {
  Write-Host 'Your browser will open once the server answers.' -ForegroundColor DarkGray
}
else {
  Write-Host 'Auto-open is off. Open the URL above once the server answers.' -ForegroundColor DarkGray
}
Write-Host 'Press Ctrl+C in this window to stop the server.' -ForegroundColor DarkGray
Write-Host ''

# The server runs here at the top level, not inside a function: a native command inside a
# function writes into the function's output, which detaches Vite from the console. The opener
# is stopped however the server ends, Ctrl+C included, so it cannot open a browser against a port
# the server has already let go. --strictPort: the port was checked free, so Vite fails rather
# than moving somewhere the opener is not watching.
$opener = if ($AutoOpen) { Start-BrowserOpener $url $BrowserChoice } else { $null }
try {
  pnpm run $Mode --port $serverPort --strictPort @ViteHostArgs
  $serverExit = $LASTEXITCODE
}
finally {
  if ($opener) { Remove-Job -Job $opener -Force }
}
exit $serverExit
