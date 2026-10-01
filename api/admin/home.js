// api/admin/home.js — /admin redirects straight to the one thing that lives
// under it today.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302;
  res.setHeader('Location', '/admin/operating-model');
  res.end();
}
