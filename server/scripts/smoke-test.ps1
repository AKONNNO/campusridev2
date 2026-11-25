$ErrorActionPreference = 'Stop'
$base = 'http://localhost:5000'

function Col($name, $value) { Write-Output ("{0,-32} {1}" -f $name, $value) }

# --- auth guard: no token on an admin route should be 401 ---
try {
    Invoke-WebRequest "$base/api/admin/feedback" | Out-Null
    Col 'AUTH GUARD (no token)' 'FAIL - got 200'
} catch {
    Col 'AUTH GUARD (no token)' ("{0} (expect 401)" -f [int]$_.Exception.Response.StatusCode)
}

# --- admin login + real admin sanity ---
$login = Invoke-RestMethod -Method Post "$base/api/auth/login" -ContentType 'application/json' -Body '{"phone":"0241234001","pin":"admin123"}'
Col 'ADMIN LOGIN' "role=$($login.user.role) name=$($login.user.name)"
$ah = @{ Authorization = "Bearer $($login.token)" }
$admins = Invoke-RestMethod -Headers $ah "$base/api/admin/drivers"
Col 'ADMIN /drivers' "count=$($admins.Count)"

# --- driver login; driver token on admin route should be 403 ---
$dlogin = Invoke-RestMethod -Method Post "$base/api/auth/login" -ContentType 'application/json' -Body '{"phone":"0241234002","pin":"1234"}'
Col 'DRIVER LOGIN' "role=$($dlogin.user.role) name=$($dlogin.user.name) driverId=$($dlogin.driverId)"
$dh = @{ Authorization = "Bearer $($dlogin.token)" }
try {
    Invoke-WebRequest -Headers $dh "$base/api/admin/feedback" | Out-Null
    Col 'ROLE GUARD (driver token)' 'FAIL - got 200'
} catch {
    Col 'ROLE GUARD (driver token)' ("{0} (expect 403)" -f [int]$_.Exception.Response.StatusCode)
}

$me = Invoke-RestMethod -Headers $dh "$base/api/driver/me"
Col 'DRIVER /me' "bus=$($me.bus.bus_number) route=$($me.bus.routeName) routesAvail=$($me.availableRoutes.Count)"

# --- full trip lifecycle on the assigned bus ---
$start = Invoke-RestMethod -Method Post -Headers $dh "$base/api/driver/trip/start" -ContentType 'application/json' -Body '{}'
Col 'TRIP START' "ok=$($start.ok) tripId=$($start.trip.id) routeId=$($start.trip.routeId)"

$st = Invoke-RestMethod -Method Post -Headers $dh "$base/api/driver/status" -ContentType 'application/json' -Body '{"status":"break"}'
Col 'STATUS break' "ok=$($st.ok) bus.status=$($st.bus.status)"

$live = Invoke-RestMethod "$base/api/buses/live"
Col 'LIVE BUSES' "count=$($live.Count) first=$($live[0].busNumber) status=$($live[0].status) route=$($live[0].route.code)"

try {
    $arrivals = Invoke-RestMethod "$base/api/stops/1/arrivals"
    Col 'ARRIVALS @stop 1' "arrivals=$($arrivals.arrivals.Count)"
} catch {
    Col 'ARRIVALS @stop 1' ("error: {0}" -f $_.Exception.Message)
}

$end = Invoke-RestMethod -Method Post -Headers $dh "$base/api/driver/trip/end"
Col 'TRIP END' "ok=$($end.ok) tripId=$($end.tripId)"

$liveAfter = Invoke-RestMethod "$base/api/buses/live"
$stillThere = $liveAfter | Where-Object { $_.busNumber -eq $me.bus.bus_number }
if ($stillThere) { Col 'LIVE AFTER END' 'FAIL - bus still listed after trip end' }
else { Col 'LIVE AFTER END' 'OK - bus removed from live map' }

# --- trip history + reports (admin) ---
$trips = Invoke-RestMethod -Headers $ah "$base/api/admin/trips"
Col 'ADMIN /trips' "count=$($trips.Count) statuses=$((($trips | Select-Object -ExpandProperty status) -join ','))"

$rep = Invoke-RestMethod -Headers $ah "$base/api/admin/reports/summary"
Col 'ADMIN reports' "trips7d=$($rep.tripsPerDay.Count) busyStops=$($rep.busiestStops.Count) completed=$($rep.durationInfo.completedTrips)"

# --- planner ---
try {
    $plan = Invoke-RestMethod "$base/api/trip-plan?from=1&to=2"
    Col 'TRIP-PLAN 1->2' "options=$($plan.options.Count) msg=$($plan.message)"
} catch {
    Col 'TRIP-PLAN 1->2' ("error: {0}" -f $_.Exception.Message)
}
