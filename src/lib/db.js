/**
 * Local database using localStorage.
 * Supports: create, update, delete, filter, list, bulkCreate.
 */

const PREFIX = 'bc2_';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

function load(name) {
  try {
    return JSON.parse(localStorage.getItem(PREFIX + name) || '[]');
  } catch {
    return [];
  }
}

function save(name, items) {
  localStorage.setItem(PREFIX + name, JSON.stringify(items));
}

function matches(item, filters) {
  return Object.entries(filters).every(([k, v]) => item[k] === v);
}

function sorted(items, sort) {
  if (!sort) return items;
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...items].sort((a, b) => {
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

export function createEntityAPI(name) {
  return {
    create(data) {
      const items = load(name);
      const item = { id: generateId(), created_date: new Date().toISOString(), ...data };
      items.push(item);
      save(name, items);
      return Promise.resolve(item);
    },

    update(id, data) {
      const items = load(name);
      const idx = items.findIndex(i => i.id === id);
      if (idx === -1) return Promise.reject(new Error('Not found: ' + id));
      items[idx] = { ...items[idx], ...data };
      save(name, items);
      return Promise.resolve(items[idx]);
    },

    delete(id) {
      save(name, load(name).filter(i => i.id !== id));
      return Promise.resolve();
    },

    filter(filters = {}, sort = null, limit = null) {
      let items = load(name).filter(i => matches(i, filters));
      items = sorted(items, sort);
      if (limit) items = items.slice(0, limit);
      return Promise.resolve(items);
    },

    list(sort = null, limit = null) {
      let items = sorted(load(name), sort);
      if (limit) items = items.slice(0, limit);
      return Promise.resolve(items);
    },

    bulkCreate(dataArray) {
      const items = load(name);
      const now = new Date().toISOString();
      const created = dataArray.map(d => ({ id: generateId(), created_date: now, ...d }));
      save(name, [...items, ...created]);
      return Promise.resolve(created);
    },
  };
}
