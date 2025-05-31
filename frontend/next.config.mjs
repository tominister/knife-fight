/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Enable static optimization where possible
  output: 'standalone',
  // Configure images if you're using next/image
  images: {
    domains: [], // Add any image domains you need
  },
}

export default nextConfig; 