// 从 OpenStreetMap（Overpass）取雪道与索道，写入 scripts/cache/osm.json。
// 数据许可：© OpenStreetMap contributors, ODbL。
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, 'cache/osm.json');
// 禾木吉克普林一带：south, west, north, east
const BBOX = process.env.OSM_BBOX ?? '48.30,87.20,48.80,87.95';
const TIMEOUT_MS = 45000;
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const query = `[out:json][timeout:40];
(
  way["piste:type"](${BBOX});
  way["aerialway"](${BBOX});
  node["aerialway"="station"](${BBOX});
);
out geom;`;

async function fetchFrom(endpoint) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'hemu-like-terrain/1.0' },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!Array.isArray(json.elements)) throw new Error('响应里没有 elements');
  return json;
}

let data = null;
for (const endpoint of ENDPOINTS) {
  const started = Date.now();
  try {
    data = await fetchFrom(endpoint);
    console.log(`OK ${endpoint} ${data.elements.length} 个要素 ${Date.now() - started}ms`);
    break;
  } catch (err) {
    console.log(`FAIL ${endpoint} ${Date.now() - started}ms ${err.message}`);
  }
}
if (!data) {
  console.error('所有 Overpass 节点都失败了');
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(data));

const ways = data.elements.filter((e) => e.type === 'way');
const pistes = ways.filter((w) => w.tags?.['piste:type']);
const lifts = ways.filter((w) => w.tags?.aerialway);
const lats = ways.flatMap((w) => w.geometry?.map((g) => g.lat) ?? []);
const lons = ways.flatMap((w) => w.geometry?.map((g) => g.lon) ?? []);
console.log(`雪道 ${pistes.length} 条，索道 ${lifts.length} 条`);
if (lats.length) {
  console.log(`范围 lat ${Math.min(...lats).toFixed(4)}..${Math.max(...lats).toFixed(4)} lon ${Math.min(...lons).toFixed(4)}..${Math.max(...lons).toFixed(4)}`);
}
