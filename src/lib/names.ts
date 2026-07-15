const TITLES = ['Mr', 'Ms', 'Mx', 'Dr', 'Sir', 'Dame', 'Lord', 'Lady', 'Captain', 'Professor', 'Duke', 'Baron', 'Esq', 'Count'];

const ADJECTIVES = [
  'Funky', 'Dubious', 'Sneaky', 'Wobbly', 'Spicy', 'Grumpy', 'Fancy', 'Mysterious',
  'Soggy', 'Zesty', 'Gallant', 'Sly', 'Plucky', 'Rowdy', 'Silly', 'Dapper', 'Feral', 'Nifty',
];

const PRODUCE = [
  'Carrot', 'Potato', 'Turnip', 'Mango', 'Kale', 'Pickle', 'Broccoli', 'Eggplant',
  'Radish', 'Kiwi', 'Parsnip', 'Cabbage', 'Fig', 'Beet', 'Yam', 'Avocado', 'Leek', 'Papaya',
];

/** Generates a fun placeholder name (e.g. "Mr Funky Carrot") for players who skip the name field. */
export function generateFunName(): string {
  const title = TITLES[Math.floor(Math.random() * TITLES.length)];
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const produce = PRODUCE[Math.floor(Math.random() * PRODUCE.length)];
  return `${title} ${adjective} ${produce}`;
}
