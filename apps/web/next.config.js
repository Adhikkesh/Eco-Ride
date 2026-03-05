/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
        protocol: "https",
      },
      {
        hostname: "firebasestorage.googleapis.com",
        pathname: "/**",
        protocol: "https",
      },
    ],
  },
  // output: "standalone", // Disabled: requires symlink permissions on Windows. Enable in Docker/CI.
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
