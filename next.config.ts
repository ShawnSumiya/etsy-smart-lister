import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // プロジェクトのルートを明示的に指定して、
    // 親ディレクトリの lockfile をルートとして誤検出しないようにする
    root: process.cwd(),
  },
};

export default nextConfig;
