/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  typedRoutes: false,
  // 开发模式与生产构建使用不同的产物目录。
  // 否则开发服务运行期间执行一次构建，就会把开发缓存覆盖掉，页面直接打不开。
  distDir: process.env.YUJIAN_DIST_DIR || ".next",
};

export default nextConfig;
