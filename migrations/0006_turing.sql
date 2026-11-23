-- 奶龙 is now turing (js/config.js): a bot that plays heads up from a strategy trained offline (tools/turing) and the
-- bots' common core at the 7-handed tables. It keeps its id, so its history and stats stay its own. On a new
-- database the bots are seeded with this name already and this changes nothing.

UPDATE players SET name = '🤖 turing' WHERE id = 'ubot00000nailong' AND name = '🤖 奶龙';
