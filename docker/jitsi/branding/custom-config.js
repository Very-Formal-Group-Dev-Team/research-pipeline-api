// Archivum branding — appended to config.js on Jitsi web container start.
// Keep in sync with research-pipeline-web/lib/meetings/jitsiTheme.ts

config.hideConferenceSubject = true;
config.hideDisplayName = true;
config.hideConferenceTimer = true;
config.disableReactions = false;
config.disableRaiseHand = false;
// Archivum control bar opens settings programmatically — keep the native button in DOM.
config.toolbarButtons = ['settings'];
config.toolbarConfig = {
  alwaysVisible: false,
  initialTimeout: 0,
};

// Stage pinning breaks Archivum's left-overlay filmstrip + full-width main video layout.
config.filmstrip = {
  disableStageFilmstrip: true,
};

config.customTheme = {
  shape: {
    borderRadius: 2,
  },
};
