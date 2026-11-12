/**
 * 数据文件（world.json 和高程网格）的两种来源：
 * 平时从 data/ 目录请求；单文件版双击就开，浏览器不让 file:// 页面发请求，
 * 所以打包时把它们嵌进页面的 <script> 里，这里先找嵌进来的，没有再去请求。
 */

const EMBED_PREFIX = 'embedded-data:';

/** 嵌进页面的数据所在 <script> 的 id；打包脚本也用它，两边对得上。 */
export function embedId(name) {
  return EMBED_PREFIX + name;
}

/** 页面里嵌着的这份数据的文本；没嵌就是 null。 */
function embedded(name) {
  return document.getElementById(embedId(name))?.textContent ?? null;
}

async function request(name) {
  const res = await fetch(`data/${name}`);
  if (!res.ok) throw new Error(`无法读取 data/${name}，先运行 npm run terrain`);
  return res;
}

/** base64 文本还原成二进制。 */
function decodeBase64(text) {
  const raw = atob(text.trim());
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/** 读一份 JSON 数据。 */
export async function readJson(name) {
  const text = embedded(name);
  if (text !== null) return JSON.parse(text);
  return (await request(name)).json();
}

/** 读一份二进制数据，返回 ArrayBuffer。 */
export async function readBinary(name) {
  const text = embedded(name);
  if (text !== null) return decodeBase64(text);
  return (await request(name)).arrayBuffer();
}
