const fs = require('fs');
const path = require('path');
const root = __dirname;
const indexPath = path.join(root, 'public/index.html');
let index = fs.readFileSync(indexPath, 'utf8');
const replacements = [
  ['<title>NOVA</title>', '<title>DARK CHAT</title>'],
  ['<meta name="theme-color" content="#0B0C14">', '<meta name="theme-color" content="#050505">'],
  ['<div class="auth-logo">N</div>', '<div class="auth-logo">D</div>'],
  ['Welcome to NOVA', 'Welcome to DARK CHAT'],
  ['Your NOVA ID', 'Your DARK CHAT ID'],
  ["Create my NOVA ID", 'Create my DARK CHAT ID'],
  ['Already have a NOVA ID?', 'Already have a DARK CHAT ID?'],
  ['<label>NOVA ID</label>', '<label>DARK CHAT ID</label>'],
  ['placeholder="NOVA-123456"', 'placeholder="+1-626-715-1xxx"'],
  ['<h1>NOVA</h1>', '<h1>DARK CHAT</h1>'],
  ["friend's NOVA ID", "friend's DARK CHAT ID"],
  ["Friend's NOVA ID", "Friend's DARK CHAT ID"],
  ['Members (NOVA IDs, comma separated)', 'Members (DARK CHAT IDs, comma separated)'],
  ['NOVATECH link or code', 'DARK CHAT invite link or code'],
  ['nova.link/', 'dark.chat/'],
  ['Pick a chat, or start a new one with a friend\'s NOVA ID.', 'Pick a chat, or start a new one with a friend\'s DARK CHAT ID.'],
  ['<link rel="stylesheet" href="/css/style.css">', '<link rel="stylesheet" href="/css/style.css">\n<link rel="stylesheet" href="/css/dark-chat.css">'],
  ['<label>NOVATECH Link</label>', '<label>DARK CHAT invite link</label>']
];
for (const [a, b] of replacements) index = index.split(a).join(b);
fs.writeFileSync(indexPath, index);

const idGenPath = path.join(root, 'db/idGen.js');
let idGen = fs.readFileSync(idGenPath, 'utf8');
idGen = idGen.replace("const candidate = `NOVA-${digits}`;", "const candidate = `+1-626-715-${String(digits).slice(-4)}`;");
idGen = idGen.replace('Could not generate a unique NOVA ID', 'Could not generate a unique DARK CHAT ID');
fs.writeFileSync(idGenPath, idGen);

const authPath = path.join(root, 'routes/auth.js');
let auth = fs.readFileSync(authPath, 'utf8');
auth = auth.replace('NOVA ID and password are required', 'DARK CHAT ID and password are required').replace('Wrong NOVA ID or password', 'Wrong DARK CHAT ID or password').replace('No one has that NOVA ID', 'No one has that DARK CHAT ID');
fs.writeFileSync(authPath, auth);

const appPath = path.join(root, 'public/js/app.js');
let app = fs.readFileSync(appPath, 'utf8');
app = app.replace(/NOVA ID/g, 'DARK CHAT ID').replace(/NOVA IDs/g, 'DARK CHAT IDs').replace(/NOVA-\d{6}/g, '+1-626-715-1xxx');
const oldPost = '      <div class="post-caption">${escapeHtml(p.caption)}</div>\n    </div>';
const newPost = '      <div class="post-caption">${escapeHtml(p.caption || \'\')}</div>\n      <div class="post-actions-row"><button class="post-like-btn" data-like-id="${p.id}">♥ <span>${p.like_count || 0}</span></button><button class="post-comment-btn" data-comment-id="${p.id}">Comments (${p.comment_count || 0})</button></div>\n      <div class="post-comment-panel hidden" id="comments-${p.id}"><div class="comments-list"></div><form class="comment-form" data-comment-form="${p.id}"><input maxlength="500" placeholder="Write a comment..."><button type="submit">Send</button></form></div>\n    </div>';
if (!app.includes('data-comment-form')) app = app.replace(oldPost, newPost);
const marker = `// ---------------- INIT ----------------`;
const commentLogic = `// ---------------- POST COMMENTS ----------------\nfunction wirePostComments() {\n  $$('.post-comment-btn').forEach(btn => btn.addEventListener('click', async () => {\n    const panel = document.querySelector('#comments-' + btn.dataset.commentId);\n    panel.classList.toggle('hidden');\n    if (panel.dataset.loaded) return;\n    const result = await api('/posts/' + btn.dataset.commentId + '/comments');\n    panel.querySelector('.comments-list').innerHTML = result.comments.map(c => '<div class="post-comment"><strong>' + escapeHtml(c.display_name) + '</strong> ' + escapeHtml(c.content) + '</div>').join('') || '<div class="post-comment">No comments yet.</div>';\n    panel.dataset.loaded = '1';\n  }));\n  $$('.comment-form').forEach(form => form.addEventListener('submit', async e => {\n    e.preventDefault(); const input = form.querySelector('input'); if (!input.value.trim()) return;\n    await api('/posts/' + form.dataset.commentForm + '/comments', { method:'POST', body:{ content: input.value.trim() } });\n    input.value = ''; await loadPosts();\n  }));\n}\n`;
app = app.replace(marker, commentLogic + marker);
app = app.replace('  }\n}\n// ---------------- INIT ----------------', '  }\n  wirePostComments();\n}\n// ---------------- INIT ----------------');
fs.writeFileSync(appPath, app);
