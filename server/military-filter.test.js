'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _detectMilitaryStrict: strict } = require('./military-aircraft');

test('sources complémentaires : vols de ligne des plages nationales écartés (cas réels du 15/11)', () => {
  for (const [hex, cs] of [['738054', 'ELY2374'], ['4891b9', 'ENT218'], ['781cfd', 'CSS134'], ['4b8de5', 'CAI056P'],
    ['78037b', 'CAO3036'], ['3c5827', 'IFA1462'], ['3c5642', 'BOX590'], ['151df9', 'SDM5969'], ['4b8750', 'PGT58FU'],
    ['150692', 'JTC9001'], ['a00639', 'N100RP']]) {
    assert.equal(strict(hex, cs), null, cs);
  }
});

test('sources complémentaires : militaires connus conservés (indicatif ou opérateur militaire)', () => {
  for (const [hex, cs] of [['ae1234', 'RCH871'], ['15a0b1', 'RFF7012'], ['3b7a12', 'CTM2014'], ['489512', 'PLF101'],
    ['456100', 'NATO01'], ['43c5d2', 'RRR6655'], ['3c5a10', 'GAF651'], ['738a11', ''], ['111111', 'FORTE10']]) {
    assert.ok(strict(hex, cs), cs || hex);
  }
  assert.equal(strict('ae1234', 'RCH871').country, 'USA', 'pays tiré de la plage hex');
  assert.equal(strict('400000', 'BAW123'), null, 'hors plage militaire');
});
