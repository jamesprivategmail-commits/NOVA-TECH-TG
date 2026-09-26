const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const STORE_PATH = path.join(__dirname, '../db/data-store.json');

const firstNames = [
  'Liam', 'Noah', 'Oliver', 'Elijah', 'James', 'William', 'Benjamin', 'Lucas', 'Henry', 'Theodore',
  'Jack', 'Levi', 'Alexander', 'Jackson', 'Mateo', 'Daniel', 'Michael', 'Mason', 'Sebastian', 'Ethan',
  'Logan', 'Owen', 'Samuel', 'Jacob', 'Asher', 'Aiden', 'John', 'Joseph', 'Wyatt', 'David',
  'Leo', 'Luke', 'Julian', 'Hudson', 'Grayson', 'Matthew', 'Ezra', 'Gabriel', 'Carter', 'Isaac',
  'Jayden', 'Luca', 'Anthony', 'Dylan', 'Lincoln', 'Thomas', 'Maverick', 'Elias', 'Josiah', 'Charles',
  'Caleb', 'Christopher', 'Ezekiel', 'Miles', 'Jaxon', 'Isaiah', 'Andrew', 'Joshua', 'Nathan', 'Nolan',
  'Adrian', 'Cameron', 'Santiago', 'Eli', 'Aaron', 'Ryan', 'Angel', 'Cooper', 'Colin', 'Christian',
  'Roman', 'Axel', 'Brooks', 'Jonathan', 'Robert', 'Jameson', 'Ian', 'Everett', 'Greyson', 'Wesley',
  'Jeremiah', 'Hunter', 'Leonardo', 'Jordan', 'Jose', 'Bennett', 'Silas', 'Nicholas', 'Beau', 'Weston',
  'Austin', 'Connor', 'Carson', 'Dominic', 'Xavier', 'Jaxson', 'Jace', 'Emmett', 'Declan', 'Rowen',
  'Sophia', 'Emma', 'Olivia', 'Isabella', 'Ava', 'Mia', 'Harper', 'Evelyn', 'Abigail', 'Emily',
  'Ella', 'Elizabeth', 'Camila', 'Luna', 'Sofia', 'Avery', 'Mila', 'Aria', 'Scarlett', 'Penelope',
  'Layla', 'Chloe', 'Victoria', 'Madison', 'Eleanor', 'Grace', 'Nora', 'Riley', 'Zoey', 'Hannah',
  'Hazel', 'Lily', 'Ellie', 'Violet', 'Lillian', 'Zoe', 'Stella', 'Aurora', 'Natalie', 'Emilia',
  'Everly', 'Leah', 'Aubrey', 'Willow', 'Addison', 'Lucy', 'Audrey', 'Bella', 'Nova', 'Claire',
  'Skylar', 'Isla', 'Genesis', 'Naomi', 'Elena', 'Caroline', 'Eliana', 'Anna', 'Maya', 'Valentina',
  'Ruby', 'Kennedy', 'Ivy', 'Arianna', 'Aaliyah', 'Cora', 'Madelyn', 'Alice', 'Kinsley', 'Hailey',
  'Gabriella', 'Allison', 'Gianna', 'Serenity', 'Samantha', 'Sarah', 'Quinn', 'Eva', 'Piper', 'Sadie',
  'Delilah', 'Josephine', 'Nevaeh', 'Adeline', 'Emery', 'Lydia', 'Jade', 'Peyton', 'Brielle', 'Adalynn',
  'Vivian', 'Rylee', 'Clara', 'Raelynn', 'Melanie', 'Athena', 'Reagan', 'Freya', 'Leilani', 'Liliana'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts',
  'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes',
  'Stewart', 'Morris', 'Morales', 'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper',
  'Peterson', 'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
  'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza', 'Ruiz', 'Hughes',
  'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers', 'Long', 'Ross', 'Foster', 'Jimenez'
];

const colors = [
  '#0A84FF', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2',
  '#5E5CE6', '#64D2FF', '#FF375F', '#AC8E68', '#40C8E0',
  '#32ADE6', '#007AFF', '#34C759', '#FF9500', '#AF52DE'
];

const sampleBios = [
  '', '', '', '', // Many users have no bio
  'Offline most of the time.',
  'Only checking messages occasionally.',
  'Digital nomad & explorer.',
  'Photography & sound design.',
  'Design, code & coffee.',
  'Night owl.',
  'Silent reader.',
  'Busy building things.',
  'Peace & quiet.',
  'Nature lover 🌲',
  'Music on repeat 🎧',
  'Catch me offline.',
  'Away from keyboard.',
  'Simplicity is key.'
];

function generateNovaId(index) {
  const countryCodes = ['+1', '+44', '+49', '+33', '+81', '+61', '+49', '+34'];
  const cc = countryCodes[index % countryCodes.length];
  const p1 = String(100 + (index * 7) % 899);
  const p2 = String(100 + (index * 13) % 899);
  const p3 = String(1000 + (index * 29) % 8999);
  return `${cc}-${p1}-${p2}-${p3}`;
}

async function run() {
  if (!fs.existsSync(STORE_PATH)) {
    console.error('Store file does not exist at:', STORE_PATH);
    process.exit(1);
  }

  const raw = fs.readFileSync(STORE_PATH, 'utf8');
  const store = JSON.parse(raw);
  if (!store.users) store.users = {};

  const currentCount = Object.keys(store.users).length;
  console.log(`Current users in store: ${currentCount}`);

  const targetToAdd = 1100;
  const passwordHash = bcrypt.hashSync('offline_user_pass_' + Date.now(), 8);

  const existingNovaIds = new Set(Object.values(store.users).map(u => (u.nova_id || '').toUpperCase()));

  let added = 0;
  const now = Date.now();

  for (let i = 0; i < targetToAdd; i++) {
    const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    const displayName = `${fn} ${ln}`;

    let novaId = generateNovaId(currentCount + i + 1);
    while (existingNovaIds.has(novaId.toUpperCase())) {
      novaId = `+1-${Math.floor(100 + Math.random() * 899)}-${Math.floor(100 + Math.random() * 899)}-${Math.floor(1000 + Math.random() * 8999)}`;
    }
    existingNovaIds.add(novaId.toUpperCase());

    const id = `u_fake_${Date.now()}_${i}_${crypto.randomBytes(3).toString('hex')}`;
    // Created between 30 and 200 days ago
    const createdDaysAgo = 30 + Math.floor(Math.random() * 170);
    const createdAt = new Date(now - createdDaysAgo * 86400 * 1000).toISOString();

    // Last seen between 2 and 45 days ago (all strictly offline)
    const lastSeenDaysAgo = 2 + Math.floor(Math.random() * 43);
    const lastSeen = new Date(now - lastSeenDaysAgo * 86400 * 1000).toISOString();

    const avatarColor = colors[Math.floor(Math.random() * colors.length)];
    const bio = sampleBios[Math.floor(Math.random() * sampleBios.length)];

    store.users[id] = {
      id,
      nova_id: novaId,
      display_name: displayName,
      password_hash: passwordHash,
      avatar_color: avatarColor,
      avatar_url: null,
      avatar_data: null,
      bio,
      is_verified: Math.random() < 0.04, // 4% verified
      is_banned: false,
      ban_reason: null,
      created_at: createdAt,
      last_seen: lastSeen,
      is_fake: true
    };

    added++;
  }

  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  console.log(`Successfully added ${added} offline accounts. Total users now: ${Object.keys(store.users).length}`);
}

run().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
