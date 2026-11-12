import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embedId } from '../src/world/dataSource.js';

/** 页面里引用脚本和样式的标签；Vite 产出的路径都以 ./ 开头。 */
const SCRIPT_TAG = /<script\b[^>]*\bsrc="\.\/([^"]+)"[^>]*><\/script>/g;
const STYLE_TAG = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="\.\/([^"]+)"[^>]*>/g;

/** 要嵌进页面的数据文件：world.json，加上它里面点名的两张高程网格。 */
function dataFiles(dataDir) {
  const world = JSON.parse(readFileSync(join(dataDir, 'world.json'), 'utf8'));
  return ['world.json', world.heightmap.file, world.backdrop.file];
}

/** 一份数据变成一个 <script>：JSON 原样放（压掉空白），二进制转 base64。浏览器不会执行这两种类型。 */
function dataTag(dataDir, name) {
  const raw = readFileSync(join(dataDir, name));
  if (!name.endsWith('.json')) {
    return `<script type="application/base64" id="${embedId(name)}">${raw.toString('base64')}</script>`;
  }
  // "<" 写成转义，免得数据里出现 </script> 把标签提前截断
  const json = JSON.stringify(JSON.parse(raw.toString('utf8'))).replaceAll('<', '\\u003c');
  return `<script type="application/json" id="${embedId(name)}">${json}</script>`;
}

/** 取出打包产物里的一个文件的内容，并把它从产物里拿掉（已经并进页面了）。 */
function take(bundle, fileName) {
  const file = bundle[fileName];
  if (!file) throw new Error(`single-file: 页面引用的 ${fileName} 不在打包产物里`);
  delete bundle[fileName];
  return file.type === 'chunk' ? file.code : String(file.source);
}

/** 脚本写进页面：代码里的 </script 要转义，否则浏览器会把它当成标签结束。 */
function inlineScript(code) {
  if (code.includes('<!--')) throw new Error('single-file: 脚本里有 <!--，直接写进页面会被浏览器误读');
  return `<script type="module">${code.replaceAll('</script', '<\\/script')}</script>`;
}

/**
 * Vite 插件：把页面引用的脚本、样式和数据文件全部并进一个 html，双击就能打开。
 * dataDir 是数据文件所在目录，fileName 是产出的文件名。
 */
export function singleFile({ dataDir, fileName }) {
  return {
    name: 'single-file',
    enforce: 'post',
    generateBundle(_, bundle) {
      const page = Object.values(bundle).find((file) => file.fileName.endsWith('.html'));
      if (!page) throw new Error('single-file: 打包产物里没有 html');
      const data = dataFiles(dataDir).map((name) => dataTag(dataDir, name)).join('\n');
      // 替换内容用函数给出：代码里的 $ 不能被当成替换占位符
      page.source = String(page.source)
        .replace(SCRIPT_TAG, (_tag, src) => inlineScript(take(bundle, src)))
        .replace(STYLE_TAG, (_tag, href) => `<style>${take(bundle, href)}</style>`)
        .replace('</body>', () => `${data}\n</body>`);
      delete bundle[page.fileName];
      page.fileName = fileName;
      bundle[fileName] = page;
    },
  };
}
