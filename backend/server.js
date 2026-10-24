require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const studentRoutes = require('./routes/studentRoutes');

const app = express();
const port = process.env.PORT || 5000;

// const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
//   .split(',').map(origin => origin.trim()).filter(Boolean);

const allowedOrigins = [
  "https://student-management-system-6lju.vercel.app",
  "https://student-management-system-6lju-on5pr8nv1-aayush-b1e4.vercel.app",
  "https://student-management-system-6lju-git-main-aayush-b1e4.vercel.app"
];

app.use(cors({
  origin: allowedOrigins
}));

app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.json({ success: true, service: 'student-management-api', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.use('/api/students', studentRoutes);

app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` }));

app.use((err, _req, res, _next) => {
  if (err.message === 'Origin not allowed by CORS') return res.status(403).json({ success: false, message: 'Origin not allowed by CORS' });
  if (err.name === 'ValidationError') return res.status(400).json({ success: false, message: err.message });
  if (err.code === 11000) return res.status(409).json({ success: false, message: 'Student ID or email already exists' });
  console.error(err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB Atlas');
    app.listen(port, () => console.log(`API listening on port ${port}`));
  })
  .catch(error => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });