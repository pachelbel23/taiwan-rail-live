// 把台鐵待避側線的進出站路徑補進出貨路網的 paths（只補路徑：way 已在 network.json，也不改派車表）。
// rail-3d/physical/overtake-sidings.js 待避換股只從已打包的路徑挑；pack_physical_network.mjs 只打包派車表用到的路徑，
// 派車表從沒派過車的側線就換不過去——10/9 6016 在南平等 2 次，側線 way 1175170157（OSM service=siding）走得到，
// 兩車卻停／過同一股。範圍：只補既有 OSM 側線上的路徑，不造新股道。
//
// 每條路徑都要過：經過的 way 與下面逐條覆核過的清單相同；不逆向走方向股道（track_directions.mjs 的 wrongOn）；
// 進站段、出站段在停車點接得上，與同站對現行派車路徑的前一段、後一段也接得上（turnOK：道岔不倒車）。
// 只有一段的組（和仁、金崙）沒有另一段可比，改檢查出貨路網裡以這一段終點為起點的路徑都接得上它，而且至少有一條
//（終點是派車表已在用的雙向股道時，只比 arrivesLike 在那裡接得上的那幾條）。
// 長度：側線要繞進繞出，出站段比該站對派車表最長的路徑長 0.146 m。跑段剖面的站間長取該站對「會畫的路徑」最長者
// （maxPathM，點速才恆 ≤ 車種極速、不留容差），所以 build_tra_track_sections.mjs 與 overtake-sidings.js 都把這裡記的
// overtakePaths 算進最長路徑；這裡只擋「比派車表最長的長超過 1 m」，免得一條側線把整個站對的剖面拉長。
//
// 路徑已在出貨路網、只差登記的（和仁）：崇德停靠點→和仁側線（way 598634593，OSM service=siding）的進站段本來就在
// network.json 的 paths，派車表沒派過車。它比該站對派車表最長的路徑長 0.786 m，overtake-sidings.js 的長度篩子
// （路徑長 ≤ 最長路徑 + 1e-3）把整條「崇德停→和仁側線→和平」擋掉，和仁的待避車換不到另一股、兩車停／過同一股。
// 這種路徑只登記進 extensions[].overtakePaths（paths 不重複補）；上面的檢查照過，路徑不在 paths 裡才補。
//
// 出站要回到正式停靠那一股的（金崙）：北上待避車停金崙側線（way 1175180550），下一站太麻里是正式停靠、節點固定在
// 9267198334。那一股在 OSM 標 service=spur（約 302 m），純正線求不到路徑，改走 spur 又超過 YARD_CAP_M，所以出貨路網
// 只有「側線→太麻里正線 9267198336」，待避車換不到側線、超越車從它身上穿過。這組的出站段（arrivesLike）只准走派車表
// 已經走過、同樣停進這一股的那條路徑的 spur 段；出站接頭照它在停車點接得上的後一段檢查。
//
// 跑法：node scripts/extend_tra_overtake_sidings.mjs（就地改 rail-3d/physical/network.json；NETWORK=／OUT= 可換檔），
// 之後 rail-3d/physical/level-profiles.json 只換 inputSha256 裡 network.json 的雜湊，
// 再重跑 node scripts/build_tra_track_sections.mjs、npm run build-run-profiles、npm run build-manifest。
// 🔴 重新打包 network.json 之後要再跑一次；每組（一站一筆）用 extensions 的 name 判斷是否已補入，重跑無害。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { makeDirectionModel } from './lib/track_directions.mjs';

const file = process.env.NETWORK || 'rail-3d/physical/network.json', out = process.env.OUT || file;
const net = JSON.parse(fs.readFileSync(file, 'utf8'));
const dispatch = JSON.parse(fs.readFileSync('rail-3d/physical/dispatch.json', 'utf8'));

// 一站一組，name 是 extensions 裡的冪等記號。mainline＝同一站對現行派車的正線路徑（接頭對照用）。
const NOTE_TAIL = 'overtakePaths＝路徑編號→[前站, 後站]，build_tra_track_sections.mjs 與 overtake-sidings.js 把它們算進該站對的最長路徑。';
const SIDINGS = [{
  // 南下（林榮新光→南平→鳳林）停側線上的推估停車點。
  name: '台鐵待避側線路徑（南平）', date: '2026-09-29', source: 'OpenStreetMap（way 本來就在出貨路網；只補路徑）',
  note: '同向待避換股用（rail-3d/physical/overtake-sidings.js）；派車表沒有派車。' + NOTE_TAIL,
  station: '南平', stop: 'estimated:tra_sched:南平:1175170157:2', siding: '1175170157',
  legs: [
    { from: '7026780284', to: 'estimated:tra_sched:南平:1175170157:2', pair: ['林榮新光', '南平'], mainline: 4440,
      ways: ['549750562', '549750560', '549750559', '549750556', '549750561', '1175170157'] },
    { from: 'estimated:tra_sched:南平:1175170157:2', to: '10920130434', pair: ['南平', '鳳林'], mainline: 3868,
      ways: ['1175170157', '1021846206', '1021846207', '1021846208', '1021846210', '1175170155', '1175170154', '1175170151'] },
  ],
}, {
  // 南下（崇德→和仁→和平）：只有進站段，出站段（和仁側線→和平）出貨路網已有、長度也在篩子內。
  name: '台鐵待避側線路徑（和仁）', date: '2026-10-18', source: 'OpenStreetMap（way 與路徑本來就在出貨路網；只登記）',
  note: '同向待避換股用（rail-3d/physical/overtake-sidings.js）；路徑本來就在出貨路網、派車表沒有派車，這裡只登記。' + NOTE_TAIL,
  station: '和仁', siding: '598634593',
  legs: [
    { from: 'estimated:tra_sched:崇德:1061049122:2', to: '5697429402', pair: ['崇德', '和仁'], mainline: 21022,
      ways: ['1061049122', '296584799', '197169804', '1467921332', '1467921333', '197169777', '197169766', '197169769', '1270414589', '197169775', '197169779', '231221449', '598634593'] },
  ],
}, {
  // 北上（瀧溪→金崙→太麻里）：只有出站段，進站段（瀧溪→金崙側線）出貨路網已有。arrivesLike＝派車表金崙正線→太麻里 9267198334。
  name: '台鐵待避側線路徑（金崙）', date: '2026-10-19', source: 'OpenStreetMap（way 本來就在出貨路網；只補路徑）',
  note: '同向待避換股用（rail-3d/physical/overtake-sidings.js）；派車表沒有派車。' + NOTE_TAIL,
  station: '金崙', siding: '1175180550',
  legs: [
    { from: '10920235415', to: '9267198334', pair: ['金崙', '太麻里'], mainline: 21033, arrivesLike: 20083,
      ways: ['1175180550', '1175180551', '81151560', '118296635', '118296633', '118296630', '146741674', '146741843', '146741726', '146741819', '146741832', '146741700', '146741871', '146741717', '146741677', '146741721', '146741823', '146741847', '146741876', '146741735', '146741910', '146741766', '146741678', '146741725', '81151575', '1175179822'] },
  ],
}];

const todo = SIDINGS.filter(s => !net.extensions?.some(e => e.name === s.name));
for (const s of SIDINGS) if (!todo.includes(s)) console.log('已補入', s.name);
if (!todo.length) process.exit(0);

const M = makeDirectionModel({ net, dispatch });
const { clean } = M.classify();
const pairMax = new Map();
for (const [, plan] of M.plans) {
  const sig = M.sigOf(plan);
  plan.pathIds.forEach((id, i) => { const k = [sig[i][0], sig[i + 1][0]].sort().join('|'); if (M.paths[id]) pairMax.set(k, Math.max(pairMax.get(k) || 0, M.paths[id].lengthM)); });
}
// arrivesLike 的組：求路徑時准走 spur／yard，但經過的 spur／yard 邊只能是 arrivesLike 那條派車路徑走過的。
const spurRoute = (leg, clean) => {
  const like = M.paths[leg.arrivesLike];
  assert(like && like.to === leg.to, leg.pair.join('→') + ' arrivesLike 不是停進同一個節點的派車路徑');
  const own = new Set(like.edgeIds), isYard = e => ['yard', 'spur'].includes(e.tags.service);
  const edgeAllowed = (edge, from) => { const dom = clean.get(edge.wayId); return dom === undefined || (edge.a === from ? 1 : -1) === dom; };
  const penalties = new Map(Object.values(M.edges).filter(isYard).map(e => [e.resource, e.length * 20]));
  const r = M.g.shortestPath({ from: leg.from, to: leg.to, system: 'tra_sched', maxLength: like.lengthM * 1.25 + 300, edgeAllowed, allowYard: true, penalties });
  if (!r) return null;
  assert(r.edgeIds.every(id => !isYard(M.edges[id]) || own.has(id)), leg.pair.join('→') + ' 走了 arrivesLike 沒走過的 spur／yard');
  return { id: M.register(r), lengthM: r.lengthM };
};
const neighbours = (id, side) => new Set(M.plans.flatMap(([, p]) => p.pathIds.flatMap((x, i) => x !== id ? [] : side < 0 ? (i ? [p.pathIds[i - 1]] : []) : (i + 1 < p.pathIds.length ? [p.pathIds[i + 1]] : []))));
const extensions = [], fresh = new Set(), report = [];
for (const s of todo) {
  assert.equal(net.ways.find(w => String(w.id) === s.siding)?.tags?.service, 'siding', s.station + ' 側線 way 不在路網或不是 siding');
  const ids = s.legs.map(leg => {
    const main = M.paths[leg.mainline];
    assert(main && (main.from === leg.from || main.to === leg.to), leg.pair.join('→') + ' 對照的正線路徑端點不符');
    const r = M.cleanRoute(leg.from, leg.to, main.lengthM, clean, new Map()) ?? (leg.arrivesLike != null ? spurRoute(leg, clean) : null);
    assert(r, leg.pair.join('→') + ' 找不到順向路徑');
    const p = M.paths[r.id];
    assert.deepEqual([...new Set(p.edgeIds.map(e => M.edges[e].wayId))], leg.ways, leg.pair.join('→') + ' 經過的 way 與覆核清單不同');
    assert.equal(M.wrongOn(p, clean).length, 0, leg.pair.join('→') + ' 逆向走方向股道');
    const max = pairMax.get(leg.pair.map(n => 'tra_sched:' + n).sort().join('|'));
    assert(max > 0 && p.lengthM - max < 1, `${leg.pair.join('→')} ${p.lengthM.toFixed(3)} m 比派車表最長 ${max} m 長超過 1 m`);
    if (!net.paths[r.id]) fresh.add(r.id);
    report.push(`${leg.pair.join('→')} 路徑 ${r.id}：${p.lengthM.toFixed(3)} m（正線 ${main.lengthM.toFixed(3)}、派車表最長 ${max.toFixed(3)}）${fresh.has(r.id) ? '' : '，出貨路網既有'}`);
    return r.id;
  });
  if (ids.length > 1) assert(M.turnOK(ids[0], ids[1]), s.station + ' 進站段接不上出站段');
  else {
    const like = s.legs[0].arrivesLike;
    const out = Object.keys(M.paths).filter(id => M.paths[id]?.from === s.legs[0].to && (like == null || M.turnOK(like, id)));
    assert(out.length && out.every(id => M.turnOK(ids[0], id)), s.station + ' 這一段的終點沒有可接的後一段，或接不上它們');
  }
  for (const prev of neighbours(s.legs[0].mainline, -1)) if (M.turnOK(prev, s.legs[0].mainline)) assert(M.turnOK(prev, ids[0]), s.station + ' 前一段 ' + prev + ' 接不上進站段');
  if (s.legs[1]) for (const next of neighbours(s.legs[1].mainline, 1)) if (M.turnOK(s.legs[1].mainline, next)) assert(M.turnOK(ids[1], next), s.station + ' 出站段接不上後一段 ' + next);
  const overtakePaths = {};
  s.legs.forEach((leg, i) => { overtakePaths[ids[i]] = leg.pair; });
  extensions.push({ name: s.name, source: s.source, date: s.date, overtakePaths, note: s.note });
}
for (const id of fresh) net.paths[id] = M.newPaths[id];
net.extensions = [...(net.extensions || []), ...extensions];
fs.writeFileSync(out, JSON.stringify(net));
console.log(report.join('\n') + `\n登記 ${extensions.length} 組、補入 ${fresh.size} 條新路徑 → ${out}`);
