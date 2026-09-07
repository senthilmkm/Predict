import express from 'express';
import cors from 'cors';
import path from 'path';
import { apiRouter } from './routes/api';
import { workerRouter } from './routes/worker';
import { adminRouter } from './routes/admin';

const app = express();
const PORT = Number(process.env.PORT) || 8080;

app.use(cors());
app.use(express.json());

// Serve static Admin Portal UI at /admin
app.use(express.static(path.join(__dirname, '../public')));

// Admin API endpoints
app.use('/admin/api', adminRouter);

// API routes for client control
app.use('/', apiRouter);

// Worker routes for 20s tick scheduler
app.use('/', workerRouter);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Predict GCP Cloud Backend running on 0.0.0.0:${PORT}`);
  });
}

export { app };

