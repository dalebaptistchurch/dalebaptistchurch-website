import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public');
const HTML_FILES = ['index.html', 'about.html', 'connect.html', 'events.html', 'ministries.html', 'sermons.html', 'thank-you.html'];
const COPY_PATHS = ['images', 'admin', 'robots.txt', 'sitemap.xml'];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function plainText(html = '') {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function safeMarkdown(markdown = '') {
  return sanitizeHtml(marked.parse(String(markdown)), {
    allowedTags: ['p', 'br', 'strong', 'em', 'blockquote', 'ul', 'ol', 'li', 'h2', 'h3', 'a'],
    allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: 'a',
        attribs: { ...attrs, rel: 'noopener noreferrer' }
      })
    }
  });
}

function dateOnly(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function dateLabel(value) {
  const iso = dateOnly(value);
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`));
}

function nextDay(value) {
  const iso = dateOnly(value);
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function readEntries(relativeDir) {
  const dir = path.join(ROOT, relativeDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .map(name => {
      const parsed = matter(fs.readFileSync(path.join(dir, name), 'utf8'));
      return { ...parsed.data, body: parsed.content, source: name };
    });
}

function replaceRegion(html, name, content) {
  const start = `<!-- CMS:${name}:START -->`;
  const end = `<!-- CMS:${name}:END -->`;
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`Missing or invalid CMS region: ${name}`);
  }
  if (html.indexOf(start, startIndex + start.length) >= 0 || html.indexOf(end, endIndex + end.length) >= 0) {
    throw new Error(`CMS region must appear exactly once: ${name}`);
  }
  return html.slice(0, startIndex + start.length) + `\n${content}\n` + html.slice(endIndex);
}

function categoryClass(category = '') {
  const value = String(category).toLowerCase();
  if (value.includes('men')) return 'tag-men';
  if (value.includes('women')) return 'tag-women';
  if (value.includes('youth')) return 'tag-youth';
  if (value.includes('church')) return 'tag-church';
  return 'tag-all';
}

function eventDates(event) {
  return {
    starts: dateOnly(event.announcement_date),
    expires: dateOnly(event.expiration_date) || nextDay(event.event_date)
  };
}

function eventAttributes(event) {
  const { starts, expires } = eventDates(event);
  return `${starts ? ` data-starts="${escapeHtml(starts)}"` : ''} data-expires="${escapeHtml(expires)}"`;
}

function eventSlide(event) {
  const image = event.image || '/images/church-exterior.webp';
  return `      <div class="carousel-slide"${eventAttributes(event)}>
        <div class="slide-img" style="background-image:url('${escapeHtml(image)}'); height:200px; background-size:cover; background-position:center;"></div>
        <div class="slide-body">
          <span class="slide-tag ${categoryClass(event.category)}">${escapeHtml(event.category || 'All Church')}</span>
          <p class="slide-date">${escapeHtml(dateLabel(event.event_date))}</p>
          <h2 class="slide-title">${escapeHtml(event.title)}</h2>
          <p class="slide-desc">${escapeHtml(event.description)}</p>
          <a href="events.html" class="slide-link">Learn More</a>
        </div>
      </div>`;
}

function eventCard(event) {
  const image = event.image || '/images/church-exterior.webp';
  const details = event.details ? `<p class="event-time">&#9656; ${escapeHtml(event.details)}</p>` : '';
  return `    <div class="event-item"${eventAttributes(event)}>
      <img loading="lazy" class="event-image" src="${escapeHtml(image)}" alt="${escapeHtml(event.title)}" />
      <div class="event-body">
        <div class="event-meta">
          <span class="event-date">${escapeHtml(dateLabel(event.event_date))}</span>
          <span class="event-tag ${categoryClass(event.category)}">${escapeHtml(event.category || 'All Church')}</span>
        </div>
        <h2 class="event-title">${escapeHtml(event.title)}</h2>
        <p class="event-desc">${escapeHtml(event.description)}</p>
        ${details}
      </div>
    </div>`;
}

function latestNoteSection(note) {
  if (!note) {
    return `<section class="pastor-note-home"><div class="pastor-note-home-inner"><span class="about-label">Pastor Notes</span><h2>A Note From Our Pastor</h2><p>No Pastor Note has been published yet.</p><a class="pastor-note-link" href="pastor-notes.html">View Pastor Notes</a></div></section>`;
  }
  const html = safeMarkdown(note.body);
  const excerpt = plainText(html).slice(0, 360);
  return `<section class="pastor-note-home"><div class="pastor-note-home-inner"><span class="about-label">Pastor Notes</span><p class="pastor-note-date">${escapeHtml(dateLabel(note.date))}</p><h2>${escapeHtml(note.title)}</h2><p>${escapeHtml(excerpt)}${plainText(html).length > 360 ? '…' : ''}</p><p class="pastor-note-author">— ${escapeHtml(note.author || 'Pastor')}</p><a class="pastor-note-link" href="pastor-notes.html">Read Pastor Notes</a></div></section>`;
}

const noteStyles = `
  .pastor-note-home { padding:64px 24px; background:var(--gray-bg); }
  .pastor-note-home-inner { max-width:760px; margin:0 auto; background:var(--white); border:1px solid var(--gray-border); border-radius:8px; padding:clamp(28px,5vw,52px); }
  .pastor-note-home h2 { font-size:clamp(1.7rem,4vw,2.5rem); line-height:1.15; margin:10px 0 18px; }
  .pastor-note-home p { color:var(--gray-dark); line-height:1.8; }
  .pastor-note-date { font-size:.7rem; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
  .pastor-note-author { margin:16px 0 24px; font-weight:700; color:var(--black) !important; }
  .pastor-note-link { display:inline-block; padding:12px 18px; border:1px solid var(--black); border-radius:4px; color:var(--black); font-size:.7rem; font-weight:700; letter-spacing:.12em; text-transform:uppercase; text-decoration:none; }
  .pastor-note-link:hover { background:var(--black); color:var(--white); }
  .pastor-notes-page { padding:56px 24px 80px; background:var(--gray-bg); }
  .pastor-notes-list { max-width:860px; margin:0 auto; display:flex; flex-direction:column; gap:24px; }
  .pastor-note-card { padding:clamp(26px,5vw,48px); background:var(--white); border:1px solid var(--gray-border); border-radius:8px; }
  .pastor-note-card h2 { font-size:clamp(1.5rem,3vw,2.1rem); margin:8px 0 18px; }
  .pastor-note-body { color:var(--gray-dark); line-height:1.8; }
  .pastor-note-body p, .pastor-note-body ul, .pastor-note-body ol, .pastor-note-body blockquote { margin:0 0 16px; }
  .pastor-note-body blockquote { border-left:3px solid var(--black); padding-left:18px; }
  .pastor-note-body a { color:var(--black); font-weight:700; }
`;

function pastorNotesPage(baseHtml, notes) {
  const articles = notes.length ? notes.map(note => `
    <article class="pastor-note-card">
      <p class="pastor-note-date">${escapeHtml(dateLabel(note.date))}</p>
      <h2>${escapeHtml(note.title)}</h2>
      <div class="pastor-note-body">${safeMarkdown(note.body)}</div>
      <p class="pastor-note-author">— ${escapeHtml(note.author || 'Pastor')}</p>
    </article>`).join('') : '<article class="pastor-note-card"><h2>No notes published yet</h2><p>Our first Pastor Note will appear here soon.</p></article>';
  const main = `<main id="main-content">
<div class="about-page-hero"><div class="about-hero-inner"><span class="about-hero-eyebrow">Dale Baptist Church — Dale, Oklahoma</span><h1 class="about-hero-h1">Pastor Notes</h1><p class="about-hero-verse">Encouragement, updates, and reflections from our pastor.</p></div></div>
<section class="pastor-notes-page"><div class="pastor-notes-list">${articles}</div></section>
</main>`;
  return baseHtml
    .replaceAll('About Us | Dale Baptist Church', 'Pastor Notes | Dale Baptist Church')
    .replaceAll('Learn what Dale Baptist Church believes, why we exist, and how we seek to follow Jesus and serve others in Dale, Oklahoma.', 'Read current and previous Pastor Notes from Dale Baptist Church in Dale, Oklahoma.')
    .replaceAll('https://www.dalebaptistchurch.org/about.html', 'https://www.dalebaptistchurch.org/pastor-notes.html')
    .replace('</style>', `${noteStyles}\n</style>`)
    .replace(/<main id="main-content">[\s\S]*?<\/main>/, main);
}

function copyPath(relativePath) {
  const source = path.join(ROOT, relativePath);
  const destination = path.join(OUT, relativePath);
  fs.cpSync(source, destination, { recursive: true });
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const notes = readEntries('content/pastor-notes')
  .filter(note => note.draft !== true)
  .sort((a, b) => dateOnly(b.date).localeCompare(dateOnly(a.date)));

const todayIso = new Date().toISOString().slice(0, 10);
const events = readEntries('content/events')
  .filter(event => event.draft !== true)
  .filter(event => eventDates(event).expires >= todayIso)
  .sort((a, b) => dateOnly(a.event_date).localeCompare(dateOnly(b.event_date)));

for (const file of HTML_FILES) {
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (file === 'index.html') {
    html = html.replace('</style>', `${noteStyles}\n</style>`);
    html = replaceRegion(html, 'FEATURED-EVENTS', events.filter(event => event.featured === true).map(eventSlide).join('\n'));
    html = replaceRegion(html, 'PASTOR-NOTE', latestNoteSection(notes[0]));
  }
  if (file === 'events.html') {
    html = replaceRegion(html, 'EVENT-LIST', events.map(eventCard).join('\n'));
  }
  fs.writeFileSync(path.join(OUT, file), html);
}

for (const item of COPY_PATHS) copyPath(item);
fs.writeFileSync(path.join(OUT, 'pastor-notes.html'), pastorNotesPage(fs.readFileSync(path.join(ROOT, 'about.html'), 'utf8'), notes));

console.log(`Build complete: ${notes.length} published Pastor Notes, ${events.length} published Events.`);
