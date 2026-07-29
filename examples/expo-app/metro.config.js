// The SDK is vendored as a tarball (vendor/aethexai-react.tgz), so it installs
// into node_modules like any package — the default Expo Metro config resolves it
// with no extra wiring. (Cloud builds like EAS can't see a `file:../..` link.)
const { getDefaultConfig } = require("expo/metro-config")

module.exports = getDefaultConfig(__dirname)
