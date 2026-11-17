// electron-builder configuration (D-259, D-260, D-261, D-291). Run through `npm run dist:dir` (an unpacked folder, for
// trying the packaged app) or `npm run dist` (the installer); both build with electron-vite first. Output: `release/`
// (git-ignored). Paths are relative to `apps/desktop`.

/** @type {import('electron-builder').Configuration} */
export default {
  // Neutral identifier; change it together with the product name when the final name is chosen (D-262).
  appId: 'app.researchlab.desktop',
  productName: 'Research Lab',
  copyright: 'Research Lab',
  directories: { output: 'release', buildResources: 'build' },

  // The bundle is `out/` (main, workers, preload, renderer). Production dependencies are added by electron-builder: only
  // the modules the main bundle leaves external (pdfjs-dist, fflate, the Agent SDK, D-052, D-205). The workspace
  // packages are bundled sources and never needed at run time. The Claude Code executable of the SDK (one package per
  // platform, ~356 MB) is NOT shipped: the app uses the CLI the user installed (D-261).
  files: [
    'out/**/*',
    'package.json',
    '!**/*.map',
    '!**/node_modules/@rl/**',
    '!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**',
    '!**/node_modules/**/{test,tests,__tests__,example,examples,docs,.github}/**',
    '!**/node_modules/**/*.{md,markdown,ts,mts,cts,tsbuildinfo}',
    '!**/node_modules/**/{LICENSE,LICENSE.md,LICENSE.txt,CHANGELOG.md,README.md}',
  ],
  asar: true,
  // Real files on disk: pdf.js finds its own worker by path, and `new Worker(path)` of the main bundle's workers (and the
  // chunks they import) reads real files. If the check of `dist:dir` shows a worker also starts from inside the archive,
  // these can be removed (D-260).
  asarUnpack: ['node_modules/pdfjs-dist/**', 'out/main/*-worker.js', 'out/main/chunks/**'],
  // Nothing is downloaded or rebuilt: no native module, and Electron comes from the installed package.
  npmRebuild: false,
  electronDist: '../../node_modules/electron/dist',
  // Only the two interface languages ship their Chromium locale files.
  electronLanguages: ['it', 'en-US'],
  compression: 'normal',
  publish: null,

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'ResearchLab-Setup-${version}.${ext}',
  },
  nsis: {
    // Per-user install without administrator rights, with the choice of the folder (a second Windows account installs its own copy).
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: false,
    createStartMenuShortcut: true,
    createDesktopShortcut: true,
    shortcutName: 'Research Lab',
    // The installer follows the system language. The uninstaller never deletes the user's data: settings, secrets, local
    // indexes, backups, the data folders of the libraries and the documents all stay.
    multiLanguageInstaller: true,
    installerLanguages: ['it_IT', 'en_US'],
    deleteAppDataOnUninstall: false,
  },

  // Electron Fuses (D-260), written into the executable by electron-builder.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    // The UI is served from `rl-app://`, not `file://`.
    grantFileProtocolExtraPrivileges: false,
    loadBrowserProcessSpecificV8Snapshot: false,
  },
};
