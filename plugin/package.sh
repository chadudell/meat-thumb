#!/usr/bin/env bash
# Build a tester installer: dist/MeatThumb-<version>.pkg
#
# Universal (Apple Silicon + Intel), macOS 12+. Installs the AU to
# /Library/Audio/Plug-Ins/Components and refreshes the AU cache.
#
# Signing: if a "Developer ID Application" / "Developer ID Installer" identity
# is in your keychain, set SIGN_APP / SIGN_PKG to them and the component and
# installer are signed (then notarize with `xcrun notarytool`). Otherwise the
# component is ad-hoc signed and testers approve the installer once in
# System Settings → Privacy & Security.
set -euo pipefail
cd "$(dirname "$0")"

export PATH="$(python3 -m site --user-base 2>/dev/null)/bin:$PATH"
if ! echo '#include <algorithm>' | clang++ -x c++ -fsyntax-only - 2>/dev/null; then
  export CXXFLAGS="-isystem $(xcrun --show-sdk-path)/usr/include/c++/v1 ${CXXFLAGS:-}"
fi
generator=(); command -v ninja >/dev/null && generator=(-G Ninja)
juce=(); [[ -n "${JUCE_DIR:-}" ]] && juce=(-DJUCE_DIR="$JUCE_DIR")
[[ -z "${JUCE_DIR:-}" && -d ../../JUCE ]] && juce=(-DJUCE_DIR="$(cd ../../JUCE && pwd)")

cmake ${generator[@]+"${generator[@]}"} -B build-release -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 ${juce[@]+"${juce[@]}"}
cmake --build build-release --config Release --target MeatThumb_AU

version=$(sed -nE 's/^project\(MeatThumb VERSION ([0-9.]+).*/\1/p' CMakeLists.txt)
component="build-release/MeatThumb_artefacts/Release/AU/Meat Thumb.component"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

# Payload: exactly one component, at its install path.
mkdir -p "$stage/root/Library/Audio/Plug-Ins/Components" "$stage/scripts"
ditto "$component" "$stage/root/Library/Audio/Plug-Ins/Components/Meat Thumb.component"
xattr -cr "$stage/root"
codesign --force --deep --timestamp=none --options runtime --sign "${SIGN_APP:--}" \
  "$stage/root/Library/Audio/Plug-Ins/Components/Meat Thumb.component"
cp installer/postinstall "$stage/scripts/postinstall"

# Always install to /Library, even if a copy exists elsewhere.
pkgbuild --analyze --root "$stage/root" "$stage/components.plist" >/dev/null
plutil -replace 0.BundleIsRelocatable -bool NO "$stage/components.plist"

pkgbuild --root "$stage/root" --component-plist "$stage/components.plist" \
  --identifier com.meatthumb.synth.au --version "$version" \
  --scripts "$stage/scripts" --install-location / "$stage/MeatThumbAU.pkg"

cat > "$stage/distribution.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Meat Thumb $version</title>
  <welcome file="welcome.html"/>
  <conclusion file="conclusion.html"/>
  <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
  <domains enable_localSystem="true"/>
  <volume-check><allowed-os-versions><os-version min="12.0"/></allowed-os-versions></volume-check>
  <choices-outline><line choice="au"/></choices-outline>
  <choice id="au" title="Meat Thumb (Audio Unit)"><pkg-ref id="com.meatthumb.synth.au"/></choice>
  <pkg-ref id="com.meatthumb.synth.au" version="$version">MeatThumbAU.pkg</pkg-ref>
</installer-gui-script>
XML

mkdir -p dist
out="dist/MeatThumb-$version.pkg"
sign=(); [[ -n "${SIGN_PKG:-}" ]] && sign=(--sign "$SIGN_PKG")
productbuild --distribution "$stage/distribution.xml" --resources installer \
  --package-path "$stage" ${sign[@]+"${sign[@]}"} "$out"
echo "Built $out"
