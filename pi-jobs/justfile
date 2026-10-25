label := "io.github.ferologics.pi-jobs"
daemon := justfile_directory() / "daemon"
plist := home_directory() / "Library/LaunchAgents" / label + ".plist"
log := home_directory() / "Library/Logs/pi-jobs.log"

default:
    @just --list

# Type-check the daemon (needs `npm --prefix daemon ci` once)
check:
    tsc -p {{ daemon }}

# Run the daemon in the foreground (Ctrl+C to stop); stop the launchd agent first
dev:
    cd {{ daemon }} && node --import ./resolve-ts.mjs main.ts

# Install daemon dependencies and (re)start the launchd agent
install:
    npm --prefix {{ daemon }} ci
    mkdir -p "$(dirname {{ plist }})"
    sed -e "s|@NODE@|$(command -v node)|" -e "s|@DAEMON@|{{ daemon }}|" -e "s|@LOG@|{{ log }}|" {{ daemon }}/launchd.plist > {{ plist }}
    launchctl bootout gui/$(id -u)/{{ label }} 2>/dev/null || true
    # bootout returns before the service is gone; bootstrap fails with EIO until it is.
    for _ in $(seq 50); do launchctl print gui/$(id -u)/{{ label }} >/dev/null 2>&1 || break; sleep 0.2; done
    launchctl bootstrap gui/$(id -u) {{ plist }}
    @echo "pi-jobs daemon installed; logs: {{ log }}"

# Follow the daemon log
logs:
    tail -f {{ log }}

# Restart the daemon (picks up code changes)
restart:
    launchctl kickstart -k gui/$(id -u)/{{ label }}

# Show launchd state and daemon health
status:
    launchctl print gui/$(id -u)/{{ label }} | grep -E '^\s+(state|pid|last exit code) ' || true
    curl -fsS http://127.0.0.1:4747/api/health && echo

# Stop the daemon and remove the launchd agent (keeps jobs and state)
uninstall:
    launchctl bootout gui/$(id -u)/{{ label }} 2>/dev/null || true
    rm -f {{ plist }}
