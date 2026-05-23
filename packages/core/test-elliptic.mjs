import { ec as EC } from 'elliptic';
const ec = new EC('secp256k1');
try {
  const k = ec.keyFromPrivate('not-hex');
  console.log('private:', k.getPrivate('hex'));
  console.log('public:', k.getPublic('hex'));
  console.log('private isOdd:', k.getPrivate().isZero());
} catch (e) {
  console.log('threw:', e.message);
}

// try empty
try {
  const k = ec.keyFromPrivate('');
  console.log('empty private:', k.getPrivate('hex'));
} catch (e) {
  console.log('empty threw:', e.message);
}

// try 'zzz' which has non-hex
try {
  const k = ec.keyFromPrivate('zzz');
  console.log('zzz private:', k.getPrivate('hex'));
} catch (e) {
  console.log('zzz threw:', e.message);
}
