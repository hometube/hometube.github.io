const { withAppBuildGradle } = require("@expo/config-plugins");

// Injects a real release signingConfig into android/app/build.gradle.
// Reads credentials from Gradle properties (~/.gradle/gradle.properties or
// -P flags), so the keystore never lands in the repo:
//   RELEASE_STORE_FILE=/absolute/path/to/hometube.keystore
//   RELEASE_STORE_PASSWORD=...
//   RELEASE_KEY_ALIAS=hometube
//   RELEASE_KEY_PASSWORD=...
// When unset, the release build falls back to the debug keystore (with a
// Gradle-time warning from the template default), so local builds still work.

const RELEASE_SIGNING_CONFIG = `
        release {
            if (project.hasProperty('RELEASE_STORE_FILE')) {
                storeFile file(project.property('RELEASE_STORE_FILE'))
                storePassword project.property('RELEASE_STORE_PASSWORD')
                keyAlias project.property('RELEASE_KEY_ALIAS')
                keyPassword project.property('RELEASE_KEY_PASSWORD')
            }
        }
`;

const RELEASE_BUILD_TYPE_SIGNING =
  "$1signingConfig project.hasProperty('RELEASE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let contents = cfg.modResults.contents;
    if (contents.includes("RELEASE_STORE_FILE")) return cfg;

    contents = contents.replace("signingConfigs {", "signingConfigs {" + RELEASE_SIGNING_CONFIG);
    contents = contents.replace(
      /(\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n\s*)signingConfig signingConfigs\.debug/,
      RELEASE_BUILD_TYPE_SIGNING
    );

    cfg.modResults.contents = contents;
    return cfg;
  });
};
