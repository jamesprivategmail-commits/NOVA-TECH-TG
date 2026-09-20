// Re-export Firebase data module as the default database interface
const firebase = require('./firebase');

module.exports = {
  ...firebase,
  // Backward compatibility query stub if needed
  query: async () => {
    console.warn('PostgreSQL db.query called, but DARK CHAT has migrated to Firebase!');
    return { rows: [] };
  }
};
