// Card shorthand for tests: 'As' 'Td' '9h' '2c' → card index (suit*13 + rank-2), suits ♠♥♦♣ = s h d c.
const RANKS = '23456789TJQKA', SUITS = 'shdc';
export const card = s => SUITS.indexOf(s[1]) * 13 + RANKS.indexOf(s[0]);
export const cards = s => s.split(' ').map(card);
