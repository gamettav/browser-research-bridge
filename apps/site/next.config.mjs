// Static export so the site deploys to GitHub Pages with no server.
// For a project page served under /<repo>, set NEXT_PUBLIC_BASE_PATH=/groundtab.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath,
  assetPrefix: basePath || undefined,
  eslint: { ignoreDuringBuilds: true }
};

export default nextConfig;
