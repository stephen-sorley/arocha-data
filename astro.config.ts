import { defineConfig } from "astro/config";

import browsersListToEsbuild from "browserslist-to-esbuild";
import { Features } from "lightningcss";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://donors.arocha.us/",
  output: "static",
  adapter: cloudflare({
    imageService: "compile",
  }),
  markdown: {
    // Use prism instead of shiki for syntax highlighting - shiki doesn't work with CSP.
    syntaxHighlight: "prism",
  },
  image: {
    // Enable responsive images:
    layout: "constrained",
    // Authorize pulling all remote images into the build, as long as they're served over https:
    remotePatterns: [{ protocol: "https" }],
  },
  vite: {
    build: {
      target: browsersListToEsbuild(),
    },
    css: {
      lightningcss: {
        // Disable light-dark() polyfill, it doesn't really work right.
        // Can remove this once support hits baseline widely-avail (Nov 2026).
        exclude: Features.LightDark,
      },
    },
  },
  security: {
    csp: {
      directives: [
        // disable insecure legacy embeds like Flash and Java
        "object-src 'none'",
        // prevents injection attacks that reset the base URL of relative links
        "base-uri 'none'",
        // upgrade http resource requests to https automatically
        "upgrade-insecure-requests",
        // default everything else to very restrictive settings
        "default-src 'none'",
        "img-src 'self' data:",
        "font-src 'self'",
        "form-action 'self'",
        "connect-src 'self'"
      ],
    },
  },
});

