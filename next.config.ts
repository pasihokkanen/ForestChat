import type { NextConfig } from "next";
import withSerwist from "@serwist/next";

const nextConfig: NextConfig = {
  // Serwist handles the service worker — no manual sw config needed here.
};

export default withSerwist({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
})(nextConfig);
