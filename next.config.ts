import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// @serwist/next runs via a Webpack plugin and does NOT work with Turbopack.
// Our dev server uses Turbopack, so we disable Serwist in dev and only build
// the service worker for production (`next build && next start` or a deploy).
// The app still works offline in dev — it just won't have a cached shell until
// you run a production build.
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  reloadOnOnline: true,
  cacheOnNavigation: true,
});

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSerwist(nextConfig);
