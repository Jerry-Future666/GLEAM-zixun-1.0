import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const d3 = require(path.join(root, 'assets/vendor/d3.min.js'));
const land = JSON.parse(
  fs.readFileSync(path.join(root, 'assets/data/natural-earth-110m.geojson'), 'utf8')
);
const news = JSON.parse(
  fs.readFileSync(path.join(root, 'assets/data/news.json'), 'utf8')
);
const cityData = JSON.parse(
  fs.readFileSync(path.join(root, 'assets/data/cities.json'), 'utf8')
);

let failed = false;

console.log('Route endpoints:');
for (const story of news.stories) {
  const from = story.route.from;
  const to = story.route.to;
  const fromOk = d3.geoContains(land, from);
  const toOk = d3.geoContains(land, to);
  console.log(
    `${story.id}  ${story.route.fromLabel} ${fromOk ? 'LAND' : 'WATER'}  ->  ${story.route.toLabel} ${toOk ? 'LAND' : 'WATER'}`
  );
  if (!fromOk || !toOk) failed = true;
}

console.log('\nReference cities:');
const cities = {
  上海: [121.4737, 31.2304],
  北京: [116.4074, 39.9042],
  东京: [139.6917, 35.6895],
  新加坡: [103.8198, 1.3521],
  悉尼: [151.2093, -33.8688],
  巴黎: [2.3522, 48.8566],
  伦敦: [-0.1276, 51.5072],
  纽约: [-74.006, 40.7128],
  圣保罗: [-46.6333, -23.5505],
  开普敦: [18.4241, -33.9249],
  内罗毕: [36.8219, -1.2921],
  孟买: [72.8777, 19.076],
  柏林: [13.405, 52.52],
};
for (const [name, point] of Object.entries(cities)) {
  const ok = d3.geoContains(land, point);
  console.log(`${name}: ${ok ? 'LAND' : 'WATER'}`);
  if (!ok) failed = true;
}

console.log('\nRandom-route city pool:');
let cityWater = 0;
for (const city of cityData.cities) {
  const ok = d3.geoContains(land, [city.lon, city.lat]);
  if (!ok) {
    console.log(`${city.name}: WATER`);
    cityWater += 1;
    failed = true;
  }
}
console.log(`${cityData.cities.length - cityWater}/${cityData.cities.length} cities on land`);

if (failed) {
  console.error('\nSome coordinates fall in water for the current land dataset.');
  process.exitCode = 1;
} else {
  console.log('\nAll checked coordinates are inside the Natural Earth 110m land polygons.');
}
