#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR"
PKG_NAME="cockpit-clamav"

# --- Version management ---
VERSION_FILE="$SCRIPT_DIR/version"
if [ -f "$VERSION_FILE" ]; then
    NEW_VER=$(cat "$VERSION_FILE" | tr -d '[:space:]')
    if [ -z "$NEW_VER" ]; then
        echo "Error: version file is empty" >&2
        exit 1
    fi
else
    echo "Error: version file not found at $VERSION_FILE" >&2
    exit 1
fi

echo "Version: $NEW_VER (from version file)"

# --- Update manifest.json ---
node -e "
const fs = require('fs');
const p = '$SRC_DIR/manifest.json';
const m = JSON.parse(fs.readFileSync(p, 'utf8'));
m.plugin_version = '$NEW_VER';
fs.writeFileSync(p, JSON.stringify(m, null, 4) + '\n');
"

# --- Update footer version in index.html ---
sed -i "s/v[0-9]\+\.[0-9]\+\.[0-9]\+/v${NEW_VER}/g" "$SRC_DIR/index.html"

# --- Build deb ---
BUILD_DIR=$(mktemp -d)
DEB_DIR="$BUILD_DIR/${PKG_NAME}_${NEW_VER}_amd64"
PLUGIN_DIR="$DEB_DIR/usr/share/cockpit/$PKG_NAME"

mkdir -p "$PLUGIN_DIR" "$DEB_DIR/DEBIAN"

# Copy plugin files (exclude build artifacts)
rsync -a --exclude='build-deb.sh' --exclude='version' --exclude='*.deb' \
    --exclude='node_modules' --exclude='.git' \
    --exclude='.github' \
    "$SRC_DIR/" "$PLUGIN_DIR/"

# Create control file
INSTALLED_SIZE=$(du -sk "$PLUGIN_DIR" | cut -f1)

cat > "$DEB_DIR/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $NEW_VER
Architecture: amd64
Maintainer: cockpit-clamav <admin@localhost>
Installed-Size: $INSTALLED_SIZE
Depends: cockpit (>= 276), clamav, clamav-daemon
Section: admin
Priority: optional
Homepage: https://github.com/cockpit-clamav
Description: ClamAV Antivirus plugin for Cockpit
 A Cockpit plugin for managing ClamAV antivirus services,
 including virus scanning, quarantine management, real-time
 protection, and virus definition updates.
EOF

# Create postinst
cat > "$DEB_DIR/DEBIAN/postinst" <<'POSTINST'
#!/bin/bash
set -e
if [ "$1" = "configure" ]; then
    echo "cockpit-clamav installed successfully."
    mkdir -p /etc/cockpit/cockpit-clamav
    if systemctl is-active --quiet cockpit; then
        systemctl restart cockpit
    fi
fi
POSTINST
chmod 755 "$DEB_DIR/DEBIAN/postinst"

# Create prerm
cat > "$DEB_DIR/DEBIAN/prerm" <<'PRERM'
#!/bin/bash
set -e
if [ "$1" = "purge" ]; then
    rm -f /var/log/cockpit-clamav-scan.log 2>/dev/null || true
    rm -rf /etc/cockpit/cockpit-clamav 2>/dev/null || true
fi
PRERM
chmod 755 "$DEB_DIR/DEBIAN/prerm"

# Build
OUTPUT_DIR="$(dirname "$SCRIPT_DIR")"
DEB_FILE="$OUTPUT_DIR/${PKG_NAME}_${NEW_VER}_amd64.deb"

dpkg-deb --build "$DEB_DIR" "$DEB_FILE"

# Cleanup
rm -rf "$BUILD_DIR"

echo ""
echo "========================================="
echo " Built: $(basename "$DEB_FILE")"
echo " Version: $NEW_VER"
echo " Size: $(ls -lh "$DEB_FILE" | awk '{print $5}')"
echo "========================================="
echo ""
echo " Install: sudo dpkg -i $DEB_FILE"
echo " Remove:  sudo dpkg -r $PKG_NAME"
