-- Two bots get new names and ways of playing (js/config.js): 老周 is now ST, 阿芳 is now dwan.
-- They keep their ids, so their history and stats stay theirs. On a new database the bots are seeded with
-- these names already and this changes nothing.

UPDATE players SET name = '🤖 ST' WHERE id = 'ubot00000laozhou' AND name = '🤖 老周';
UPDATE players SET name = '🤖 dwan' WHERE id = 'ubot0000000afang' AND name = '🤖 阿芳';
