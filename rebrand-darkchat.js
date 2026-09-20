const fs = require('fs');
const replacements = {
  'server.js': [['name: \'NOVA Chat\'', "name: 'DARK CHAT'"], ['🚀 NOVA Chat running', '🚀 DARK CHAT running']],
  'routes/conversations.js': [['No one has that NOVA ID', 'No one has that DARK CHAT ID']],
  'public/index.html': [['Add member (NOVA ID)', 'Add member (DARK CHAT ID)'], ['Search by NOVA ID or name', 'Search by DARK CHAT ID or name']],
  'public/js/app.js': [['Welcome to NOVA', 'Welcome to DARK CHAT']],
  'app.js': [['Log in with your NOVA ID.', 'Log in with your DARK CHAT ID.'], ['Welcome to NOVA', 'Welcome to DARK CHAT']],
  'public/manifest.json': [['NOVA Chat', 'DARK CHAT']],
  'package.json': [['NOVA Chat - real-time messaging platform', 'DARK CHAT - real-time messaging platform']],
  'middleware/admin.js': [['NOVA IDs', 'DARK CHAT IDs'], ['NOVA ID', 'DARK CHAT ID']],
  'db/schema.sql': [['-- NOVA Chat schema', '-- DARK CHAT schema']],
  'db/migrate.js': [['NOVA Chat schema migrated successfully', 'DARK CHAT schema migrated successfully']],
  'README.md': [['# NOVA Chat', '# DARK CHAT'], ['NOVA ID', 'DARK CHAT ID'], ['NOVA sign-up', 'DARK CHAT sign-up'], ['NOVA generates', 'DARK CHAT generates'], ['NOVA-XXXXXX', '+1-626-715-1xxx']]
};
for (const [file, pairs] of Object.entries(replacements)) {
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of pairs) text = text.split(from).join(to);
  fs.writeFileSync(file, text);
}
