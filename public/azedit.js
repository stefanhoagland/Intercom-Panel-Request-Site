// Reads keypanel key assignments out of an AZedit (ADAMedit) setup file.
// Layout worked out from a real file plus screenshots of the same panel in AZedit:
// section 0x27 holds pages of 16 keys. Each key is 8 bytes (talk type/number, second
// assignment type/number), then 16 listen entries of 4 bytes, then a 10-byte gap.
const AZ_TYPES = { 0: 'Port', 1: 'PL', 2: 'IFB', 3: 'SL', 6: 'None' };
const AZ_NONE = 6; // type 6 means empty, or AT/AL on the listen side

function parseAzeditFile(buffer) {
  const b = new Uint8Array(buffer);
  const head = String.fromCharCode(...b.slice(0, 19));
  if (head !== 'ADAMedit setup file') throw new Error('This is not an AZedit setup file (.adm).');
  const u16 = (o) => (b[o] << 8) | b[o + 1];
  let sec = -1;
  for (let i = 256; i < b.length - 6; i++) {
    if (b[i] === 88 && b[i + 1] === 88 && b[i + 2] === 88 && b[i + 3] === 88 && b[i + 4] === 0 && b[i + 5] === 0x27) { sec = i; break; }
  }
  if (sec < 0) throw new Error('No keypanel keys found in this file.');
  const pages = [];
  for (let p = 0; p < 3; p++) {
    const base = sec + 96 + p * 202;
    if (base + 192 > b.length) throw new Error('The keypanel section is shorter than expected.');
    const keys = [];
    for (let k = 0; k < 16; k++) {
      const o = base + k * 8, l = base + 128 + k * 4;
      const key = {
        talk: { type: b[o + 1], num: u16(o + 2) },
        second: { type: u16(o + 4), num: u16(o + 6) },
        listen: { type: u16(l), num: u16(l + 2) },
      };
      for (const a of [key.talk, key.second, key.listen]) {
        if (a.type > 31 || a.num > 4096) throw new Error(`Page ${p + 1} key ${k + 1} doesn't look like a key assignment. The file layout may differ from the one this reader knows.`);
      }
      keys.push(key);
    }
    pages.push(keys);
  }
  return pages; // pages[0] = AZedit keys 1-16, [1] = 17-32, [2] = 33-48
}

// Name lookup key used in the AZedit names list, e.g. "port:313", "pl:54", "in:533".
function azKey(type, num, listen) {
  if (type === 0) return (listen ? 'in:' : 'port:') + num;
  const t = AZ_TYPES[type];
  return (t ? t.toLowerCase() : 't' + type) + ':' + num;
}
function azDescribe(a) {
  if (a.type === AZ_NONE) return '';
  return `${AZ_TYPES[a.type] || 'Type ' + a.type} ${a.num}`;
}
// Picks the label AZedit would show: the talk assignment, else a listen-only assignment.
function azLabel(key, names) {
  const look = (a, listen) => names[azKey(a.type, a.num, listen)] || (listen && a.type === 0 && names['port:' + a.num]) || '';
  if (key.talk.type !== AZ_NONE) return { label: look(key.talk) || azDescribe(key.talk).replace(' ', ''), what: azDescribe(key.talk), found: !!look(key.talk) };
  if (key.listen.type !== AZ_NONE) return { label: look(key.listen, true) || azDescribe(key.listen).replace(' ', ''), what: 'Listen ' + azDescribe(key.listen), found: !!look(key.listen, true) };
  return { label: '', what: '', found: true };
}
if (typeof module !== 'undefined') module.exports = { parseAzeditFile, azLabel, azKey };
