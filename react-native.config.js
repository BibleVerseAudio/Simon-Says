module.exports = {
  dependencies: {
    // Reanimated needs react-native-worklets' native side (checked at build).
    // VisionCamera's frame-processor TurboModule lookup ("Worklets") is
    // satisfied by worklets-core's JS + worklets' native runtime, so keep
    // worklets-core's Android native module excluded as before.
    'react-native-worklets-core': {
      platforms: {
        android: null,
      },
    },
  },
};
