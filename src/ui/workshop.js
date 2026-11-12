import { PATTERNS, defaultStyle } from '../player/gear/createGear.js';

const PATTERN_LABEL = {
  solid: '纯色',
  stripes: '纵条纹',
  diagonal: '斜纹',
  chevron: '箭头纹',
  split: '头尾分色',
  plaid: '格纹',
};
const STYLE_FIELDS = { top: 'color-top', base: 'color-base', accent: 'color-accent', binding: 'color-binding', pattern: 'pattern' };

const $ = (id) => document.getElementById(id);

/** 装备面板：改板面配色与图案、换上衣颜色、导入导出定制。 */
export function bindWorkshop(rider) {
  const pattern = $('pattern');
  for (const name of PATTERNS) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = PATTERN_LABEL[name] ?? name;
    pattern.append(opt);
  }
  const fields = Object.entries(STYLE_FIELDS).map(([key, id]) => [key, $(id)]);
  const show = () => {
    for (const [key, el] of fields) el.value = rider.style[key];
  };
  const apply = () => rider.setStyle(Object.fromEntries(fields.map(([key, el]) => [key, el.value])));
  for (const [, el] of fields) el.addEventListener('input', apply);
  show();

  $('gear-default').addEventListener('click', () => {
    rider.setStyle(defaultStyle());
    show();
  });
  $('export-gear').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(rider.style, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'hemu-like-gear.json';
    link.click();
    URL.revokeObjectURL(link.href);
  });
  $('import-gear').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (json.format !== 'hemu-like-gear') return;
      rider.setStyle(json);
      show();
    } catch {
      // 不是合法的 JSON，忽略
    }
  });

  const helmet = $('outfit-helmet');
  const goggles = $('outfit-goggles');
  const jacket = $('outfit-jacket');
  const paintOutfit = () => rider.setOutfit({ helmet: helmet.checked, goggles: goggles.checked, jacket: jacket.value });
  helmet.addEventListener('change', paintOutfit);
  goggles.addEventListener('change', paintOutfit);
  jacket.addEventListener('input', paintOutfit);
}
