import express from 'express';

const app = express();

// Route: POST /api/users
app.post('/api/users', async (req, res) => {
  const { name, email } = req.body;
  // Create user logic
  res.json({ id: 1, name, email });
});

// Route: GET /api/users/:id
app.get('/api/users/:id', async (req, res) => {
  const { id } = req.params;
  // Get user logic
  res.json({ id, name: 'Test User', email: 'test@example.com' });
});

export default app;