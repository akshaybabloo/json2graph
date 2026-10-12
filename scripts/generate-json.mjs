// Writes a large JSON file for testing: an array of records with nested
// objects and arrays.
//
//   node scripts/generate-json.mjs <megabytes> <output file>

import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

const [megabytes = '100', path = 'large.json'] = process.argv.slice(2);
const target = Number(megabytes) * 1024 * 1024;

const cities = ['Auckland', 'Pune', 'Lagos', 'São Paulo', 'Reykjavík', '東京', 'Montréal'];
const tags = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];

function record(id) {
	return {
		id,
		name: `user-${id.toString(36)}`,
		active: id % 3 !== 0,
		score: Math.round(Math.sin(id) * 1e6) / 1e3,
		email: id % 7 === 0 ? null : `user${id}@example.com`,
		address: {
			city: cities[id % cities.length],
			geo: { lat: (id % 180) - 90 + 0.25, lng: (id % 360) - 180 + 0.75 }
		},
		tags: tags.slice(0, id % (tags.length + 1)),
		orders: Array.from({ length: id % 4 }, (_, n) => ({
			order: id * 10 + n,
			total: ((id * 31 + n * 17) % 100000) / 100,
			items: [`sku-${(id + n) % 977}`, `sku-${(id * 7 + n) % 977}`]
		})),
		note: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(id % 3)
	};
}

const out = createWriteStream(path);
let written = 0;
let id = 0;
let chunk = '[';
while (written + chunk.length < target) {
	chunk += (id ? ',' : '') + JSON.stringify(record(id++));
	if (chunk.length >= 1 << 20) {
		written += Buffer.byteLength(chunk);
		if (!out.write(chunk)) await once(out, 'drain');
		chunk = '';
	}
}
out.end(chunk + ']');
await once(out, 'finish');
console.log(`${path}: ${id.toLocaleString()} records`);
