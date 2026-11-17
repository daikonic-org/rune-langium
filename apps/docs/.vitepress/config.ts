import { defineConfig } from 'vitepress';
import typedocSidebar from '../api/typedoc-sidebar.json' with { type: 'json' };

const isCloudflarePages = process.env.CF_PAGES === '1';
const docsBase = process.env.DOCS_BASE || (isCloudflarePages ? '/rune-studio/docs/' : '/rune-langium/');
const siteUrl =
  process.env.DOCS_SITE_URL ||
  (isCloudflarePages ? 'https://www.daikonic.dev/rune-studio/docs/' : 'https://pradeepmouli.github.io/rune-langium/');
const githubUrl = process.env.DOCS_GITHUB_URL || 'https://github.com/pradeepmouli/rune-langium';
// VitePress prepends `base` to any nav/href starting with `/`, which would
// double-prefix the studio link (/rune-studio/docs/rune-studio/studio/). Use
// the full URL on CF so it's treated as external and rendered verbatim.
const studioUrl =
  process.env.DOCS_STUDIO_URL || (isCloudflarePages ? 'https://www.daikonic.dev/rune-studio/studio/' : '/studio/');

// Escape angle-bracket patterns in typedoc-generated markdown that Vue's
// SFC parser would otherwise choke on (e.g. generic types like `Node<T>`
// or placeholder tokens like `<cursor>` that appear in LSP comments).
// Only escapes patterns inside prose lines, not inside fenced code blocks.
const escapeAngleBracketsInMd = {
  name: 'escape-angle-brackets-in-md',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.endsWith('.md')) return null;
    const lines = code.split('\n');
    let inFence = false;
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      // Escape `<T>`, `<Foo>`, `<2tabs>`, `<cursor>` — but not `</...>`, `<!--`, or `<a href...>`.
      const replaced = line.replace(/<([A-Z][A-Za-z0-9_]*|\d[A-Za-z0-9_]*|cursor)>/g, '&lt;$1&gt;');
      if (replaced !== line) {
        lines[i] = replaced;
        changed = true;
      }
    }
    return changed ? lines.join('\n') : null;
  }
};

export default defineConfig({
  vite: {
    plugins: [escapeAngleBracketsInMd]
  },
  title: 'Rune Langium',
  description: 'Langium-based TypeScript toolchain and Studio for the Rune DSL',
  base: docsBase,
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: true,
  // Match the landing page's dark-only palette. Toggle is hidden by default
  // theme when force-dark is set, which keeps the look consistent with site/.
  appearance: 'force-dark',
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap'
      }
    ],
    ['meta', { property: 'og:title', content: 'Rune Langium Docs' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Langium-based TypeScript toolchain and Studio for the Rune DSL'
      }
    ],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:url', content: siteUrl }],
    ['meta', { name: 'twitter:card', content: 'summary' }],
    ['meta', { name: 'twitter:title', content: 'Rune Langium Docs' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content: 'Langium-based TypeScript toolchain and Studio for the Rune DSL'
      }
    ]
  ],
  sitemap: {
    // VitePress resolves each page via `new URL(pagePath, hostname)`, which
    // requires a trailing slash on hostname for the base path to be preserved
    // (otherwise URL() treats the last segment as a file and strips it).
    hostname: siteUrl.endsWith('/') ? siteUrl : siteUrl + '/'
  },
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Studio', link: studioUrl },
      { text: 'API', link: '/api/' },
      { text: 'GitHub', link: githubUrl }
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/getting-started' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Usage', link: '/guide/usage' }
          ]
        }
      ],
      '/api/': [{ text: 'Packages', items: typedocSidebar }]
    },
    socialLinks: [{ icon: 'github', link: githubUrl }],
    footer: {
      message: 'Core packages released under MIT. Studio app released under FSL-1.1-ALv2.',
      copyright: 'Copyright © 2026 Pradeep Mouli'
    },
    search: { provider: 'local' }
  }
});
