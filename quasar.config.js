/* eslint-env node */

// Configuration for your app
// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file

import { defineConfig } from '@quasar/app-vite/wrappers'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig((ctx) => {
  // Public origin used for absolute Open Graph URLs in index.html. Set SITE_URL
  // at build time; on Vercel it falls back to the production domain.
  const siteUrl = (
    process.env.SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
  ).replace(/\/$/, '')

  return {
    // Exposed to index.html as <%= siteUrl %>
    htmlVariables: { siteUrl },

    // https://v2.quasar.dev/quasar-cli-vite/prefetch-feature
    // preFetch: true,

    // app boot file (/src/boot)
    // --> boot files are part of 'main.js'
    // https://v2.quasar.dev/quasar-cli-vite/boot-files
    boot: ['unregister-sw', 'pinia', 'vuex', 'auth', 'bitcoin-connect', 'global-components', 'i18n'],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#css
    css: ['app.scss'],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      'roboto-font', // optional, you are not bound to it
      'material-icons' // optional, you are not bound to it
    ],

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#build
    build: {
      target: {
        browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
        node: 'node20'
      },

      vueRouterMode: 'history', // available values: 'hash', 'history'
      publicPath: '/',

      // Keep quotes on attribute values in index.html. Quasar's default minify
      // sets removeAttributeQuotes:true, producing `<meta property=og:image
      // content=https://example.com/social_image.jpg>`. Robust crawlers (FB/
      // Twitter/Discord) parse that fine, but stricter/regex-based OG parsers in
      // some nostr clients (e.g. wisp) expect `content="..."` and silently fail —
      // so they fall back to <title> + domain and never see og:image (no social
      // card image). Disabling quote removal makes the OG tags universally
      // parseable. (Other defaults preserved.)
      htmlMinifyOptions: {
        removeComments: true,
        collapseWhitespace: true,
        removeAttributeQuotes: false,
        collapseBooleanAttributes: true,
        removeScriptTypeAttributes: true
      },

      // The 2022 codebase imports .vue components without the extension (the
      // old webpack resolver allowed it). Teach Vite's resolver to do the same
      // so those imports keep working.
      extendViteConf(viteConf) {
        viteConf.resolve = viteConf.resolve || {}
        const base = viteConf.resolve.extensions || [
          '.mjs',
          '.js',
          '.mts',
          '.ts',
          '.jsx',
          '.tsx',
          '.json'
        ]
        if (!base.includes('.vue')) base.push('.vue')
        viteConf.resolve.extensions = base

        // Some transitive deps (readable-stream, pulled in by lnurl-pay) read
        // process.version.slice(...) at module-eval; the node polyfill's
        // process shim doesn't define `version`, so give it concrete literals.
        viteConf.define = viteConf.define || {}
        viteConf.define['process.browser'] = 'true'
        viteConf.define['process.version'] = JSON.stringify('v18.0.0')
      },

      // Browser-shim Node builtins that the nostr/wallet stack reaches for
      // (Buffer, crypto, stream) — replaces the old webpack ProvidePlugin.
      vitePlugins: [
        [
          nodePolyfills,
          {
            include: ['buffer', 'crypto', 'stream', 'util', 'process', 'vm'],
            // In dev, injecting the process shim into our own modules shadows
            // the process.env values Quasar defines (the router fell back to
            // hash mode), so dev gets the shim as a global instead.
            globals: { Buffer: true, global: true, process: ctx.dev ? 'dev' : true }
          }
        ]
      ]
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#devserver
    devServer: {
      // https: true,
      open: false, // opens browser window automatically
      port: 8080
    },

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-js#framework
    framework: {
      config: {
        dark: true,
        notify: {
          closeBtn: true
        }
      },

      // Quasar plugins
      plugins: ['Notify', 'Dialog', 'Meta', 'LocalStorage', 'SessionStorage']
    },

    // animations: 'all', // --- includes all animations
    // https://quasar.dev/options/animations
    animations: [],

    // https://v2.quasar.dev/quasar-cli-vite/developing-ssr/configuring-ssr
    ssr: {
      prodPort: 3000,
      middlewares: ['render'],
      pwa: false
    },

    // https://v2.quasar.dev/quasar-cli-vite/developing-pwa/configuring-pwa
    pwa: {
      workboxMode: 'generateSW', // 'generateSW' or 'injectManifest'
      injectPwaMetaTags: true,
      swFilename: 'sw.js',
      manifestFilename: 'manifest.json',
      useCredentialsForManifestTag: false,
      manifest: {
        name: 'Astral',
        short_name: 'Astral',
        description: 'decentralized social platform (nostr client)',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#1f1f1f',
        theme_color: '#1f1f1f',
        icons: [
          { src: 'icons/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
          { src: 'icons/favicon-128x128.png', sizes: '128x128', type: 'image/png' },
          { src: 'icons/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/favicon-256x256.png', sizes: '256x256', type: 'image/png' },
          { src: 'icons/favicon-384x384.png', sizes: '384x384', type: 'image/png' },
          { src: 'icons/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-capacitor-apps/configuring-capacitor
    capacitor: {
      hideSplashscreen: true
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/developing-electron-apps/configuring-electron
    electron: {
      inspectPort: 5858,
      bundler: 'packager',
      packager: {},
      builder: {
        appId: 'ninja.astral'
      }
    }
  }
})
