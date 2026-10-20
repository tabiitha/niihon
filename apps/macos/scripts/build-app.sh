#!/bin/sh
# Builds apps/macos/build/Nihon.app for Apple Silicon: compiles the `Nihon` product, assembles the bundle
# with Bundle/Info.plist, and signs it with the App Sandbox entitlements of Bundle/Nihon.entitlements.
#
#   apps/macos/scripts/build-app.sh [release|debug]
#
# NIHON_CODESIGN_IDENTITY selects a signing identity; the default `-` signs ad hoc, which runs on the
# machine that built the app. Distribution signing and notarization belong to the packaging work.
set -eu

cd "$(dirname "$0")/.."
configuration="${1:-release}"
identity="${NIHON_CODESIGN_IDENTITY:--}"
app=build/Nihon.app

swift build --configuration "$configuration" --arch arm64 --product Nihon
binaries="$(swift build --configuration "$configuration" --arch arm64 --show-bin-path)"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binaries/Nihon" "$app/Contents/MacOS/Nihon"
cp Bundle/Info.plist "$app/Contents/Info.plist"
# One folder per interface language lets macOS offer the app's language in System Settings and translate
# its standard menus; the texts themselves are compiled into the binary.
for language in en fr ja; do
  mkdir -p "$app/Contents/Resources/$language.lproj"
done

codesign --force --options runtime --entitlements Bundle/Nihon.entitlements --sign "$identity" "$app"
codesign --verify --strict "$app"
echo "Built $(pwd)/$app"
