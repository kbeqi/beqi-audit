// Serves a small fake Webflow site for local smoke tests of the audit pipeline.
//   node scripts/fixture-server.mjs 8099
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8099);
const base = `http://localhost:${port}`;

const page = (title, body, extraHead = "") => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><title>${title}</title>
${extraHead}
<link rel="stylesheet" href="/css/fixture.webflow.css">
<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
<script src="https://cdn.example.com/blocking.js"></script>
</head><body class="body">
<div class="navbar w-nav"><a href="/" class="brand">Fixture</a><a href="/about" class="nav-link">About</a><a href="/blog/first-post" class="nav-link">Blog</a><a href="/pricing" class="nav-link-2">Pricing</a></div>
${body}
<div class="footer"><a href="/missing-page">Old page</a><a href="http://localhost:${port}/about">insecure</a><a href="https://fixture.webflow.io/about">staging</a><a href="mailto:hi@example.com">mail</a></div>
<script>gtag('config','G-ABC123');</script>
</body></html>`;

const routes = {
  "/": page(
    "Fixture Co – Home",
    `<div class="section"><div class="container-3"><h1 class="heading">Welcome</h1><div class="div-block-12"><p class="paragraph-4">Short intro text about Fixture Co and what we do for people who need things done.</p><img src="/img/hero.png" alt=""><img src="/img/team.png"></div><h3 class="heading-4">Skipped level</h3><div class="faq"><h2>FAQ</h2><p>Questions answered here.</p></div></div></div>`,
    `<meta name="description" content="Fixture Co builds things."><link rel="canonical" href="${base}/"><script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"Fixture"}</script>`,
  ),
  "/about": page(
    "Fixture Co – Home",
    `<div class="section-2"><h1 class="hero_title">About</h1><h1 class="hero_title">Second H1</h1><p class="text-block-7">${"word ".repeat(700)}</p><a href="/redirect-me">redirect</a></div>`,
    `<meta name="description" content="${"Long description ".repeat(15)}"><script type="application/ld+json">{not json}</script>`,
  ),
  "/pricing": page("Pricing – Fixture Co", `<div class="section"><h1 class="pricing_title">Pricing</h1><p>Plans start at $9.</p></div>`, `<meta name="robots" content="noindex">`),
  "/blog/first-post": page("First post", `<article class="blog_post"><h1>First post</h1><h2>Section one</h2><p>${"text ".repeat(200)}</p><h2>Section two</h2><p>${"more ".repeat(200)}</p></article>`, `<meta name="description" content="A blog post with enough description length to pass the minimum check easily.">`),
  "/orphan": page("Orphan page", `<h1>Orphan</h1><p>Nobody links here.</p>`),
};

createServer((req, res) => {
  const url = new URL(req.url, base);
  const p = url.pathname;
  if (p === "/robots.txt") return send(res, 200, "text/plain", `User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: ${base}/sitemap.xml\n`);
  if (p === "/sitemap.xml") return send(res, 200, "application/xml", `<?xml version="1.0"?><urlset>${["/", "/about", "/pricing", "/blog/first-post", "/orphan", "/gone"].map((x) => `<url><loc>${base}${x}</loc></url>`).join("")}</urlset>`);
  if (p === "/css/fixture.webflow.css") return send(res, 200, "text/css", `.w-nav{display:block}.body{margin:0}.navbar{}.brand{}.nav-link{}.nav-link-2{}.section{}.section-2{}.container-3{}.heading{}.heading-4{}.div-block-12{}.paragraph-4{}.text-block-7{}.hero_title{}.pricing_title{}.blog_post{}.faq{}.footer{}.unused_card{}.unused_card-title{}.div-block-99{}.old-cta{}`);
  if (p === "/redirect-me") { res.writeHead(301, { location: "/redirect-again" }); return res.end(); }
  if (p === "/redirect-again") { res.writeHead(302, { location: "/about" }); return res.end(); }
  if (p === "/img/hero.png" || p === "/img/team.png") return send(res, 200, "image/png", "");
  if (p === "/llms.txt") return send(res, 404, "text/plain", "nope");
  const html = routes[p];
  if (html) return send(res, 200, "text/html; charset=utf-8", html);
  send(res, 404, "text/html", "<h1>Not found</h1>");
}).listen(port, () => console.log(`fixture site on ${base}`));

function send(res, status, type, body) {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}
