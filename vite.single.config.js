import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { singleFile } from './scripts/single-file.mjs';

/**
 * 单文件版：脚本、样式、数据全并进 release/山谷雪场.html，不用起服务，双击就能玩。
 * 只打主页面；沙盘在主页面里按 B 就能看，独立的 diorama.html 不在其中。
 */
export default defineConfig({
  base: './',
  // 数据由插件嵌进页面，不再往产出目录里拷一份
  publicDir: false,
  build: {
    outDir: 'release',
    emptyOutDir: true,
    // 只有一个内联脚本，不需要预加载的那段垫片
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
      output: { inlineDynamicImports: true },
    },
  },
  plugins: [singleFile({ dataDir: resolve(__dirname, 'public/data'), fileName: '山谷雪场.html' })],
});
